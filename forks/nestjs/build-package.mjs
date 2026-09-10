import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const revision = process.argv[2];
assert.match(
  revision ?? "",
  /^[1-9]\d*$/,
  "Usage: node forks/nestjs/build-package.mjs <positive revision>",
);
assert.equal(process.platform, "darwin", "This package targets macOS");
assert.equal(process.arch, "arm64", "Run with native Apple Silicon Node.js");

const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: "inherit" });
const capture = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const template = json(join(root, "npm/oxlint/package.json"));
assert.match(template.version, /^\d+\.\d+\.\d+$/, "Start from an upstream stable version");
const version = `${template.version}-nestjs.${revision}`;
const tag = `oxlint-v${version}`;
const commit = capture("git", ["rev-parse", "HEAD"]);
const dirty = capture("git", ["status", "--porcelain", "--untracked-files=normal"]) !== "";
const target = "aarch64-apple-darwin";
const app = join(root, "apps/oxlint");
const nativeName = "oxlint.darwin-arm64.node";
const sourceNative = join(app, "src-js", nativeName);
const releaseDir = join(root, "target/nestjs-release");
const staging = join(root, "target/nestjs-package");
const bindings = join(app, "src-js/bindings.js");
const declarations = join(app, "src-js/bindings.d.ts");
const originalBindings = readFileSync(bindings);
const originalDeclarations = readFileSync(declarations);

// NAPI generates a multi-platform loader. Bundle an explicit local loader instead,
// so a broken fork binary can never fall back to an official @oxlint/binding package.
try {
  run("pnpm", ["--dir", app, "run", "build-napi-release", "--target", target, "--", "--locked"]);
  const generated = readFileSync(bindings, "utf8");
  const match = generated.match(/const \{ ([\w, ]+) \} = nativeBinding/);
  assert.ok(match, "NAPI loader format changed; review the native exports before packaging");
  const names = match[1].split(",").map((name) => name.trim());
  for (const name of names) assert.match(name, /^[A-Za-z_$][\w$]*$/);
  writeFileSync(
    bindings,
    `import { createRequire } from 'node:module'
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('This Oxlint fork requires macOS with Apple Silicon and arm64 Node.js')
const nativeBinding = createRequire(import.meta.url)('./${nativeName}')
const { ${names.join(", ")} } = nativeBinding
export { ${names.join(", ")} }
`,
  );
  run("pnpm", ["--dir", app, "run", "build-js"]);
} finally {
  writeFileSync(bindings, originalBindings);
  writeFileSync(declarations, originalDeclarations);
}

rmSync(staging, { recursive: true, force: true });
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
mkdirSync(releaseDir, { recursive: true });
cpSync(join(app, "dist"), join(staging, "dist"), { recursive: true });
assert.deepEqual(
  readdirSync(join(staging, "dist")).filter((name) => name.endsWith(".node")),
  [nativeName],
);
cpSync(join(root, "npm/oxlint/bin"), join(staging, "bin"), { recursive: true });
copyFileSync(
  join(root, "npm/oxlint/configuration_schema.json"),
  join(staging, "configuration_schema.json"),
);
copyFileSync(join(root, "LICENSE"), join(staging, "LICENSE"));
copyFileSync(join(root, "forks/nestjs/README.md"), join(staging, "README.md"));
cpSync(join(root, "forks/nestjs/rules"), join(staging, "rules"), { recursive: true });

const info = {
  repository: "https://github.com/rhuffus/oxc",
  upstreamVersion: template.version,
  version,
  tag,
  commit,
  dirty,
  target,
  nativeSha256: sha256(sourceNative),
  node: process.version,
  pnpm: capture("pnpm", ["--version"]),
  rustc: capture("rustc", ["--version"]),
};
const buildInfo = JSON.stringify(info, null, 2) + "\n";
writeFileSync(join(staging, "build-info.json"), buildInfo);
writeFileSync(join(releaseDir, "build-info.json"), buildInfo);

assert.deepEqual(
  Object.keys(template.dependencies ?? {}),
  [],
  "Review any new runtime dependencies",
);
assert.deepEqual(
  Object.keys(template.optionalDependencies ?? {}),
  [],
  "Review any new optional dependencies",
);
const manifest = {
  ...template,
  version,
  private: true,
  description: "Oxlint fork for NestJS development by rhuffus (macOS Apple Silicon)",
  homepage: "https://github.com/rhuffus/oxc/tree/codex/nestjs/forks/nestjs",
  bugs: "https://github.com/rhuffus/oxc/issues",
  repository: { type: "git", url: "git+https://github.com/rhuffus/oxc.git" },
  os: ["darwin"],
  cpu: ["arm64"],
  files: [...template.files, "build-info.json", "LICENSE", "rules"],
};
delete manifest.napi;
writeFileSync(join(staging, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
run("pnpm", ["pack", "--out", join(releaseDir, `oxlint-${version}.tgz`)], staging);
const tarball = `oxlint-${version}.tgz`;
writeFileSync(
  join(releaseDir, "checksums.txt"),
  `${sha256(join(releaseDir, tarball))}  ${tarball}\n${sha256(join(releaseDir, "build-info.json"))}  build-info.json\n`,
);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\ntarball=${tarball}\n`);
}
process.stdout.write(`${JSON.stringify(info, null, 2)}\nPackage: ${join(releaseDir, tarball)}\n`);
