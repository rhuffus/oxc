#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.ok(
  process.argv.length >= 3 && process.argv.length <= 4,
  "Usage: node forks/nestjs/smoke-package.mjs <package.tgz> [source-binding.node]",
);
assert.equal(process.platform, "darwin", "This package targets macOS");
assert.equal(process.arch, "arm64", "Run with native Apple Silicon Node.js");

const tarball = resolve(process.argv[2]);
const sourceNative = process.argv[3] && resolve(process.argv[3]);
assert.ok(statSync(tarball).isFile(), "The tarball must be a file");
if (sourceNative) assert.ok(statSync(sourceNative).isFile(), "The source binding must be a file");

// Use the workspace's existing compiler without adding dependencies to the consumer.
// The parser's resolved location also works with pnpm's isolated peer dependencies.
const workspaceRequire = createRequire(new URL("../../apps/oxlint/package.json", import.meta.url));
const parserRequire = createRequire(workspaceRequire.resolve("@typescript-eslint/parser"));
const typescriptCli = parserRequire.resolve("typescript/bin/tsc");

const temporary = mkdtempSync(join(tmpdir(), "oxlint-fork-smoke-"));
const consumer = join(temporary, "consumer");
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const write = (name, content) => writeFileSync(join(consumer, name), content);
const log = (message) => process.stdout.write(`${message}\n`);
const run = (command, args, expectedStatus = 0) => {
  const result = spawnSync(command, args, {
    cwd: consumer,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(
    result.status,
    expectedStatus,
    `${command} ${args.join(" ")} exited with ${result.status} (signal ${result.signal ?? "none"})\n${output}`,
  );
  return output;
};
const lint = (config, file, expectedStatus = 0, extra = []) =>
  run("pnpm", ["exec", "oxlint", "--config", config, ...extra, file], expectedStatus);

try {
  mkdirSync(consumer);
  write(
    "package.json",
    JSON.stringify(
      {
        name: "oxlint-fork-smoke",
        private: true,
        type: "module",
        devDependencies: { oxlint: `file:${tarball}` },
      },
      null,
      2,
    ) + "\n",
  );
  // A fresh store plus offline installation prevents an accidental registry fallback.
  run("pnpm", [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-optional",
    "--store-dir",
    join(temporary, "store"),
    "--config.auto-install-peers=false",
  ]);
  log("PASS: isolated offline installation, scripts and optional dependencies disabled");

  const packageRoot = realpathSync(join(consumer, "node_modules/oxlint"));
  const manifest = json(join(packageRoot, "package.json"));
  assert.equal(manifest.name, "oxlint");
  assert.deepEqual(manifest.os, ["darwin"]);
  assert.deepEqual(manifest.cpu, ["arm64"]);
  assert.deepEqual(
    Object.keys(manifest.dependencies ?? {}),
    [],
    "The artifact must be self-contained",
  );
  assert.deepEqual(
    Object.keys(manifest.optionalDependencies ?? {}),
    [],
    "Do not ship registry bindings",
  );
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    assert.ok(!name.startsWith("@oxlint/binding"), `Unexpected official binding peer: ${name}`);
  }

  for (const entry of [".", "./plugins-dev"]) {
    const exported = manifest.exports[entry];
    assert.equal(typeof exported.types, "string", `${entry} must export declarations`);
    assert.equal(typeof exported.default, "string", `${entry} must export JavaScript`);
    assert.ok(statSync(join(packageRoot, exported.types)).isFile());
    assert.ok(statSync(join(packageRoot, exported.default)).isFile());
  }
  assert.ok(json(join(packageRoot, "configuration_schema.json")).properties.rules);
  assert.ok(statSync(join(packageRoot, manifest.bin.oxlint)).isFile());
  assert.ok(statSync(join(packageRoot, "rules/no-static-handlers.md")).isFile());

  const nativePath = join(packageRoot, "dist/oxlint.darwin-arm64.node");
  const nativeHash = sha256(nativePath);
  const buildInfo = json(join(packageRoot, "build-info.json"));
  assert.equal(
    nativeHash,
    buildInfo.nativeSha256,
    "The installed binding must match build-info.json",
  );
  assert.equal(manifest.version, buildInfo.version);
  if (sourceNative) {
    assert.equal(
      nativeHash,
      sha256(sourceNative),
      "The installed binding must match the source build",
    );
  }
  log(`PASS: package exports, schema and native SHA-256 ${nativeHash}`);

  const version = run("pnpm", ["exec", "oxlint", "--version"]).trim();
  assert.match(version, /\b\d+\.\d+\.\d+\b/);
  log(`PASS: CLI starts (${version})`);

  write(
    "native.config.ts",
    `import { defineConfig } from 'oxlint'
export default defineConfig({ rules: { 'no-debugger': 'error' } })
`,
  );
  write("valid.ts", "export const answer = 42\n");
  write("invalid.ts", "debugger\n");
  lint("native.config.ts", "valid.ts");
  assert.match(lint("native.config.ts", "invalid.ts", 1), /no-debugger/);
  log("PASS: TypeScript config imports defineConfig; native rule accepts and rejects fixtures");

  const nestRuleName = "nestjs/no-static-handlers";
  const catalog = JSON.parse(run("pnpm", ["exec", "oxlint", "--rules", "--format", "json"]));
  const nestRule = catalog.find(
    (entry) => entry.scope === "nestjs" && entry.value === "no-static-handlers",
  );
  assert.ok(nestRule, `The installed package must contain ${nestRuleName}`);
  assert.equal(nestRule.category, "correctness");
  assert.equal(nestRule.type_aware, false);
  assert.equal(nestRule.fix, "none");
  assert.equal(
    nestRule.docs_url,
    "https://github.com/rhuffus/oxc/blob/codex/nestjs/forks/nestjs/rules/no-static-handlers.md",
  );
  const nestCategories = Object.fromEntries(
    ["correctness", "suspicious", "pedantic", "perf", "style", "restriction", "nursery"].map(
      (category) => [category, "off"],
    ),
  );
  write(
    "nestjs.config.ts",
    `import { defineConfig } from 'oxlint'\nexport default defineConfig(${JSON.stringify({ plugins: ["nestjs"], categories: nestCategories, rules: { [nestRuleName]: "error" } })})\n`,
  );
  // Nest is deliberately absent: this native rule resolves import bindings from the AST.
  assert.ok(!existsSync(join(consumer, "node_modules/@nestjs/common")));
  write(
    "nestjs-static.ts",
    "import { Get } from '@nestjs/common'; export class Controller { @Get() static route() { return 'ok' } }\n",
  );
  write(
    "nestjs-instance.ts",
    "import { Get } from '@nestjs/common'; export class Controller { @Get() route() { return 'ok' } }\n",
  );
  write(
    "nestjs-helper.ts",
    "import { Get } from '@nestjs/common'; export class Controller { @Get() route() { return 'ok' } static helper() { return 'ok' } }\n",
  );
  const staticReport = JSON.parse(
    lint("nestjs.config.ts", "nestjs-static.ts", 1, ["--format", "json"]),
  );
  assert.equal(staticReport.number_of_files, 1);
  assert.equal(staticReport.diagnostics.length, 1);
  assert.equal(staticReport.diagnostics[0].code, "nestjs(no-static-handlers)");
  assert.equal(staticReport.diagnostics[0].severity, "error");
  assert.equal(staticReport.diagnostics[0].url, nestRule.docs_url);
  for (const name of ["nestjs-instance.ts", "nestjs-helper.ts"]) {
    const report = JSON.parse(lint("nestjs.config.ts", name, 0, ["--format", "json"]));
    assert.equal(report.number_of_files, 1);
    assert.deepEqual(report.diagnostics, []);
  }
  const beforeFix = readFileSync(join(consumer, "nestjs-static.ts"), "utf8");
  const fixedReport = JSON.parse(
    lint("nestjs.config.ts", "nestjs-static.ts", 1, ["--fix", "--format", "json"]),
  );
  assert.equal(fixedReport.diagnostics.length, 1);
  assert.equal(fixedReport.diagnostics[0].code, "nestjs(no-static-handlers)");
  assert.equal(readFileSync(join(consumer, "nestjs-static.ts"), "utf8"), beforeFix);
  log(
    "PASS: packaged native Nest rule, TypeScript config, static/instance/helper HTTP fixtures and no autofix; no Nest dependency installed",
  );

  write(
    "smoke-plugin.mjs",
    `export default {
  meta: { name: 'fork-smoke' },
  rules: {
    'no-smoke-name': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { forbidden: 'Smoke plugin executed.' }
      },
      create(context) {
        return {
          Identifier(node) {
            if (node.name === 'smokeForbidden')
              context.report({ node, messageId: 'forbidden' })
          }
        }
      }
    }
  }
}
`,
  );
  write(
    "plugin.config.ts",
    `import { defineConfig } from 'oxlint'
export default defineConfig({
  jsPlugins: [{ name: 'fork-smoke', specifier: './smoke-plugin.mjs' }],
  rules: { 'fork-smoke/no-smoke-name': 'error' }
})
`,
  );
  write("plugin-invalid.ts", "export const smokeForbidden = 1\n");
  lint("plugin.config.ts", "valid.ts");
  assert.match(lint("plugin.config.ts", "plugin-invalid.ts", 1), /Smoke plugin executed\./);
  log("PASS: JavaScript plugin loads and its visitor reports a diagnostic");

  write(
    "exports.mjs",
    `import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { defineConfig } from 'oxlint'
import { RuleTester } from 'oxlint/plugins-dev'
const config = { rules: { 'no-debugger': 'error' } }
assert.equal(defineConfig(config), config)
assert.equal(typeof RuleTester, 'function')
assert.equal(createRequire(import.meta.url)('oxlint/package.json').name, 'oxlint')
`,
  );
  run(process.execPath, ["exports.mjs"]);
  write(
    "types.ts",
    `import { defineConfig, type AllowWarnDeny, type OxlintConfig } from 'oxlint'
import { RuleTester } from 'oxlint/plugins-dev'
const config: OxlintConfig = defineConfig({ rules: { 'no-debugger': 'error' } })
const nestConfig: OxlintConfig = defineConfig({ plugins: ['nestjs'], rules: { 'nestjs/no-static-handlers': 'error' } })
const tester = new RuleTester()
// @ts-expect-error Invalid severities must be rejected by the published declarations.
const invalidSeverity: AllowWarnDeny = 'not-a-severity'
// @ts-expect-error The published native Nest rule accepts no options.
defineConfig({ plugins: ['nestjs'], rules: { 'nestjs/no-static-handlers': ['error', {}] } })
void config
void nestConfig
void tester
void invalidSeverity
`,
  );
  write(
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        files: ["types.ts"],
      },
      null,
      2,
    ) + "\n",
  );
  run(process.execPath, [typescriptCli, "--project", "tsconfig.json", "--pretty", "false"]);
  log("PASS: public runtime exports and strict consumer declaration typecheck");

  // These test doubles are deliberately resolvable from the installed package.
  // An upstream fallback loader would consult them and load our hidden native file.
  const hiddenNative = `${nativePath}.hidden.node`;
  const fallbackMarker = "SMOKE_UNEXPECTED_OFFICIAL_BINDING_FALLBACK";
  for (const target of ["darwin-universal", "darwin-arm64"]) {
    const fallback = join(packageRoot, "node_modules", "@oxlint", `binding-${target}`);
    mkdirSync(fallback, { recursive: true });
    writeFileSync(
      join(fallback, "package.json"),
      JSON.stringify({
        name: `@oxlint/binding-${target}`,
        version: buildInfo.upstreamVersion,
        main: "index.cjs",
      }),
    );
    writeFileSync(
      join(fallback, "index.cjs"),
      `process.stderr.write(${JSON.stringify(fallbackMarker + "\n")})\nmodule.exports = require(${JSON.stringify(hiddenNative)})\n`,
    );
  }
  renameSync(nativePath, hiddenNative);
  try {
    const output = run("pnpm", ["exec", "oxlint", "--version"], 1);
    assert.match(output, /oxlint\.darwin-arm64\.node/);
    assert.ok(
      !output.includes(fallbackMarker),
      "The loader consulted an official binding fallback",
    );
  } finally {
    renameSync(hiddenNative, nativePath);
  }
  run("pnpm", ["exec", "oxlint", "--version"]);
  log("PASS: missing embedded binding fails closed; restoring it restores the CLI");
  log(`All package smoke checks passed for oxlint@${manifest.version}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
