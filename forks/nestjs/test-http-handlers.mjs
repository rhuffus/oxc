#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

// --cli accepts the built apps/oxlint/dist/cli.js or an installed package's dist/cli.js.
// --demo-dir supplies existing Nest/TypeScript dependencies; it is never modified.
// --schema optionally selects the schema paired with that CLI. Nothing is installed or built.
// Example: node forks/nestjs/test-http-handlers.mjs --cli apps/oxlint/dist/cli.js \
//   --demo-dir ../polaris/experiments/nestjs-demo
const { values } = parseArgs({
  options: {
    cli: { type: "string" },
    "demo-dir": { type: "string" },
    schema: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
const usage =
  "Usage: node forks/nestjs/test-http-handlers.mjs --cli <dist/cli.js> --demo-dir <installed Nest project> [--schema <configuration_schema.json>]";
if (values.help) {
  process.stdout.write(`${usage}\n`);
  process.exit(0);
}
assert.ok(values.cli && values["demo-dir"], usage);
const cli = realpathSync(resolve(values.cli));
const demo = realpathSync(resolve(values["demo-dir"]));
const packageRoot = dirname(dirname(cli));
assert.ok(existsSync(join(packageRoot, "package.json")), "--cli must be a package's dist/cli.js");
const schemaPath = values.schema
  ? resolve(values.schema)
  : [
      join(packageRoot, "configuration_schema.json"),
      join(packageRoot, "../../npm/oxlint/configuration_schema.json"),
    ].find(existsSync);
assert.ok(schemaPath, "Cannot locate the CLI's schema; pass --schema explicitly");
const demoRequire = createRequire(join(demo, "package.json"));
const ts = demoRequire("typescript");
const typescriptCli = demoRequire.resolve("typescript/bin/tsc");
const appRequire = createRequire(new URL("../../apps/oxlint/package.json", import.meta.url));
const Ajv = appRequire("ajv");
const ruleName = "nestjs/no-static-handlers";
const documentation =
  "https://github.com/rhuffus/oxc/blob/codex/nestjs/forks/nestjs/rules/no-static-handlers.md";
const categories = Object.fromEntries(
  ["correctness", "suspicious", "pedantic", "perf", "style", "restriction", "nursery"].map(
    (category) => [category, "off"],
  ),
);
const configuration = { plugins: ["nestjs"], categories, rules: { [ruleName]: "error" } };
const decorators = [
  "RequestMapping",
  "Get",
  "Post",
  "Put",
  "Delete",
  "Patch",
  "Options",
  "Head",
  "All",
  "Search",
  "QueryMethod",
  "Propfind",
  "Proppatch",
  "Mkcol",
  "Copy",
  "Move",
  "Lock",
  "Unlock",
  "Sse",
];
const temporary = mkdtempSync(join(tmpdir(), "oxlint-nestjs-http-"));
const consumer = join(temporary, "consumer");
const log = (message) => process.stdout.write(`PASS: ${message}\n`);
const write = (name, contents) => writeFileSync(join(consumer, name), contents);
const run = (command, args, expectedStatus = 0) => {
  const result = spawnSync(command, args, {
    cwd: consumer,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    expectedStatus,
    `${command} ${args.join(" ")} exited ${result.status} (signal ${result.signal ?? "none"})\n${result.stdout ?? ""}${result.stderr ?? ""}`,
  );
  return result.stdout;
};
const lint = (file, expectedCount, config = "oxlint.config.ts", extra = []) => {
  const output = run(
    process.execPath,
    [cli, "--config", config, "--format", "json", ...extra, file],
    expectedCount === 0 ? 0 : 1,
  );
  const report = JSON.parse(output);
  assert.equal(report.diagnostics.length, expectedCount, output);
  assert.equal(report.number_of_files, 1, "The fixture must actually be linted");
  for (const diagnostic of report.diagnostics) {
    assert.equal(diagnostic.severity, "error", output);
    assert.equal(
      diagnostic.code,
      config === "base.config.ts" ? "eslint(class-methods-use-this)" : "nestjs(no-static-handlers)",
      output,
    );
    if (config !== "base.config.ts") assert.equal(diagnostic.url, documentation);
  }
  return report;
};

try {
  mkdirSync(join(consumer, "node_modules"), { recursive: true });
  write(
    "package.json",
    JSON.stringify({ name: "nestjs-http-rule-test", private: true, type: "module" }),
  );
  symlinkSync(packageRoot, join(consumer, "node_modules/oxlint"), "dir");
  for (const name of ["@nestjs", "reflect-metadata", "rxjs"]) {
    const dependency = join(demo, "node_modules", name);
    assert.ok(existsSync(dependency), `Missing installed dependency ${dependency}`);
    symlinkSync(dependency, join(consumer, "node_modules", name), "dir");
  }
  const common = await import(demoRequire.resolve("@nestjs/common"));
  for (const name of decorators) {
    assert.equal(typeof common[name], "function", `${name} is not exported by the installed Nest`);
  }
  const nestVersion = JSON.parse(
    readFileSync(join(dirname(demoRequire.resolve("@nestjs/common")), "package.json"), "utf8"),
  ).version;
  assert.match(
    nestVersion,
    /^12\./,
    "Review the HTTP decorator matrix before testing a different Nest major",
  );

  // Use the same TypeScript source for the native lint assertion and actual Nest application.
  // There is no dependency injection or external service, and no existing demo server is contacted.
  const runtimeSource = `import { Controller, Get, Module } from '@nestjs/common'
@Controller()
export class HttpController {
  @Get('instance')
  instanceMethod(): string { return 'instance response' }

  @Get('static')
  static staticMethod(): string { return 'static response' }
}
@Module({ controllers: [HttpController] })
export class HttpModule {}
`;
  write("runtime-http.ts", runtimeSource);
  const transpilation = ts.transpileModule(runtimeSource, {
    fileName: "runtime-http.ts",
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    },
  });
  assert.deepEqual(transpilation.diagnostics, []);
  write("runtime-http.mjs", transpilation.outputText);
  write(
    "runtime-check.mjs",
    `import 'reflect-metadata'
import assert from 'node:assert/strict'
import { NestFactory } from '@nestjs/core'
import { HttpController, HttpModule } from './runtime-http.mjs'
const app = await NestFactory.create(HttpModule, { logger: false })
try {
  await app.listen(0, '127.0.0.1')
  const base = await app.getUrl()
  const instance = await fetch(base + '/instance', { signal: AbortSignal.timeout(5000) })
  assert.equal(instance.status, 200)
  assert.equal(await instance.text(), 'instance response')
  const missingStatic = await fetch(base + '/static', { signal: AbortSignal.timeout(5000) })
  assert.equal(missingStatic.status, 404)
  assert.equal((await missingStatic.json()).message, 'Cannot GET /static')
  assert.equal(HttpController.staticMethod(), 'static response')
  process.stdout.write(JSON.stringify({ instance: 200, static: 404, directStatic: 'static response' }) + '\\n')
} finally {
  await app.close()
}
`,
  );
  assert.deepEqual(JSON.parse(run(process.execPath, ["runtime-check.mjs"])), {
    instance: 200,
    static: 404,
    directStatic: "static response",
  });
  log(
    `Nest ${nestVersion}: instance HTTP 200, static HTTP 404, direct static call succeeds; ephemeral server closed`,
  );

  const catalog = JSON.parse(run(process.execPath, [cli, "--rules", "--format", "json"]));
  const entry = catalog.find(
    (item) => item.scope === "nestjs" && item.value === "no-static-handlers",
  );
  assert.ok(entry, `The supplied CLI does not contain ${ruleName}; build the fork first`);
  assert.equal(entry.category, "correctness");
  assert.equal(entry.type_aware, false);
  assert.equal(entry.fix, "none", "The rule must not advertise fixes or suggestions");
  assert.equal(
    entry.docs_url,
    documentation,
    "Native Nest rules must link to the fork's documentation",
  );
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv({ allErrors: true, unknownFormats: "ignore", logger: false });
  const validate = ajv.compile(schema);
  assert.ok(validate(configuration), JSON.stringify(validate.errors));
  assert.equal(
    validate({ ...configuration, rules: { [ruleName]: ["error", {}] } }),
    false,
    "The native schema must reject options for this zero-option rule",
  );
  log("native catalog metadata and schema: correctness, no types, no fixes, zero options");

  write(
    "oxlint.config.ts",
    `import { defineConfig } from 'oxlint'\nexport default defineConfig(${JSON.stringify(configuration, null, 2)})\n`,
  );
  write(
    "types.ts",
    `import { defineConfig, type OxlintConfig } from 'oxlint'
const config: OxlintConfig = defineConfig({ plugins: ['nestjs'], rules: { '${ruleName}': 'error' } })
void config
// @ts-expect-error The native rule has no options.
defineConfig({ plugins: ['nestjs'], rules: { '${ruleName}': ['error', {}] } })
`,
  );
  write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: [],
      },
      files: ["types.ts", "oxlint.config.ts"],
    }),
  );
  run(process.execPath, [typescriptCli, "--project", "tsconfig.json", "--pretty", "false"]);
  const printed = JSON.parse(
    run(process.execPath, [cli, "--config", "oxlint.config.ts", "--print-config"]),
  );
  assert.ok(printed.plugins.includes("nestjs"));
  assert.ok(printed.rules[ruleName]);
  log(
    "bare oxlint import, defineConfig, native Nest plugin, strict positive/negative declaration checks and --print-config",
  );

  write(
    "without-nest.config.ts",
    `import { defineConfig } from 'oxlint'\nexport default defineConfig(${JSON.stringify({ categories: { ...categories, correctness: "error" } })})\n`,
  );
  write(
    "without-nest.ts",
    "import { Get } from '@nestjs/common'; export class Controller { @Get() static route() { return 'ok' } }\n",
  );
  const withoutNest = JSON.parse(
    run(process.execPath, [cli, "--config", "without-nest.config.ts", "--print-config"]),
  );
  assert.ok(
    !withoutNest.plugins.includes("nestjs"),
    "The Nest plugin must require explicit opt-in",
  );
  lint("without-nest.ts", 0, "without-nest.config.ts");
  lint("without-nest.ts", 1);
  log(
    "correctness alone leaves Nest disabled; declaring the plugin makes the same static HTTP fixture fail",
  );

  const fixtures = [
    [
      "instance",
      `import { Get } from '@nestjs/common'; class Controller { @Get() route() { return 'ok' } }`,
      0,
    ],
    [
      "static-helper",
      `import { Get } from '@nestjs/common'; class Controller { @Get() route() { return 'ok' } static helper() { return 'ok' } }`,
      0,
    ],
    [
      "non-routing-decorators",
      `import { Header, HttpCode, Redirect, Render } from '@nestjs/common'; class Controller { @Header('x-test', 'yes') @HttpCode(200) @Redirect('/ok') @Render('index') static helper() { return 'ok' } }`,
      0,
    ],
    [
      "foreign-import",
      `import { Get } from 'other-framework'; class Controller { @Get() static route() {} }`,
      0,
    ],
    ["local-name", `const Get = () => () => {}; class Controller { @Get() static route() {} }`, 0],
    [
      "shadowed-name",
      `import { Get } from '@nestjs/common'; function nested(Get: () => MethodDecorator) { class Controller { @Get() static route() {} } }`,
      0,
    ],
    [
      "shadowed-namespace",
      `import * as Nest from '@nestjs/common'; function nested(Nest: { Get: () => MethodDecorator }) { class Controller { @Nest.Get() static route() {} } }`,
      0,
    ],
    [
      "type-import",
      `import type { Get } from '@nestjs/common'; class Controller { @Get() static route() {} }`,
      0,
    ],
    [
      "namespace-type-import",
      `import type * as Nest from '@nestjs/common'; class Controller { @Nest.Get() static route() {} }`,
      0,
    ],
    [
      "dynamic-namespace-key",
      `import * as Nest from '@nestjs/common'; const key = 'Get'; class Controller { @(Nest[key]()) static route() {} }`,
      0,
    ],
    [
      "assigned-alias",
      `import { Get } from '@nestjs/common'; const Route = Get; class Controller { @Route() static route() {} }`,
      0,
    ],
    [
      "default-import",
      `import Nest from '@nestjs/common'; class Controller { @Nest.Get() static route() {} }`,
      0,
    ],
    [
      "direct",
      `import { Get } from '@nestjs/common'; class Controller { @Get() static route() { return 'ok' } }`,
      1,
    ],
    [
      "aliased",
      `import { Get as Route } from '@nestjs/common'; class Controller { @Route() static route() {} }`,
      1,
    ],
    [
      "namespace",
      `import * as Nest from '@nestjs/common'; class Controller { @Nest.Get() static route() {} }`,
      1,
    ],
    [
      "namespace-string",
      `import * as Nest from '@nestjs/common'; class Controller { @(Nest['Get']()) static route() {} }`,
      1,
    ],
    [
      "namespace-template",
      'import * as Nest from "@nestjs/common"; class Controller { @(Nest[`Get`]()) static route() {} }',
      1,
    ],
    [
      "multiple-decorators",
      `import { Get, Post } from '@nestjs/common'; class Controller { @Get() @Post() static route() {} }`,
      1,
    ],
    [
      "base-controller",
      `import { Get } from '@nestjs/common'; abstract class BaseController { @Get() static route() {} }`,
      1,
    ],
    [
      "computed-method",
      `import { Get } from '@nestjs/common'; class Controller { @Get() static ['route']() {} }`,
      1,
    ],
    [
      "class-expression",
      `import { Get } from '@nestjs/common'; export const Controller = class { @Get() static route() {} }`,
      1,
    ],
  ];
  for (const name of decorators) {
    fixtures.push([
      `decorator-${name}`,
      `import { ${name} as HttpRoute } from '@nestjs/common'; class Controller { @HttpRoute() static route() {} }`,
      1,
    ]);
  }
  for (const [name, source, expectedCount] of fixtures) {
    write(`${name}.ts`, `${source}\n`);
    lint(`${name}.ts`, expectedCount);
  }
  lint("runtime-http.ts", 1);
  log(
    `${fixtures.length + 1} native lint fixtures: all 19 HTTP factories, instance methods, aliases, namespaces, semantic shadowing and deliberate unsupported forms`,
  );

  const sarif = JSON.parse(
    run(
      process.execPath,
      [cli, "--config", "oxlint.config.ts", "--format", "sarif", "direct.ts"],
      1,
    ),
  );
  const sarifRule = sarif.runs[0].tool.driver.rules.find((item) =>
    item.id.includes("no-static-handlers"),
  );
  assert.ok(sarifRule, "The SARIF diagnostic must identify the native Nest rule");
  assert.equal(sarifRule.helpUri, documentation);
  log("catalog and SARIF point to the fork's rule documentation");

  for (const extra of [["--fix"], ["--fix-suggestions"], ["--fix-dangerously"]]) {
    const before = readFileSync(join(consumer, "direct.ts"), "utf8");
    lint("direct.ts", 1, "oxlint.config.ts", extra);
    assert.equal(readFileSync(join(consumer, "direct.ts"), "utf8"), before);
  }
  log("all fix modes preserve the invalid static method and keep its diagnostic");

  write(
    "base.config.ts",
    `import { defineConfig } from 'oxlint'\nexport default defineConfig(${JSON.stringify({ plugins: [], categories, rules: { "class-methods-use-this": "error" } })})\n`,
  );
  lint("instance.ts", 1, "base.config.ts");
  log(
    "known base-rule conflict reproduced separately: class-methods-use-this rejects the valid Nest instance handler",
  );
  process.stdout.write("All native Nest HTTP handler integration checks passed.\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
