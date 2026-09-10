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
const wrapperRuleName = "nestjs/class-methods-use-this";
const wrapperDocumentation =
  "https://github.com/rhuffus/oxc/blob/codex/nestjs/forks/nestjs/rules/class-methods-use-this.md";
const wrapperCode = "nestjs(class-methods-use-this)";
const baseCode = "eslint(class-methods-use-this)";
const wrapperDefaults = {
  enforceForClassFields: true,
  exceptMethods: [],
  ignoreOverrideMethods: false,
  ignoreClassesWithImplements: undefined,
};
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
const lint = (
  file,
  expectedCount,
  config = "oxlint.config.ts",
  extra = [],
  expectedCodes = Array(expectedCount).fill(
    config === "base.config.ts" ? baseCode : "nestjs(no-static-handlers)",
  ),
) => {
  const output = run(
    process.execPath,
    [cli, "--config", config, "--format", "json", ...extra, file],
    expectedCount === 0 ? 0 : 1,
  );
  const report = JSON.parse(output);
  assert.equal(report.diagnostics.length, expectedCount, output);
  assert.equal(report.number_of_files, 1, "The fixture must actually be linted");
  assert.deepEqual(
    report.diagnostics.map((diagnostic) => diagnostic.code).sort(),
    expectedCodes.toSorted((left, right) => left.localeCompare(right)),
    output,
  );
  for (const diagnostic of report.diagnostics) {
    assert.equal(diagnostic.severity, "error", output);
    if (diagnostic.code === "nestjs(no-static-handlers)") {
      assert.equal(diagnostic.url, documentation);
    }
    if (diagnostic.code === wrapperCode) {
      assert.equal(diagnostic.url, wrapperDocumentation);
    }
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
  const wrapperEntry = catalog.find(
    (item) => item.scope === "nestjs" && item.value === "class-methods-use-this",
  );
  assert.ok(
    wrapperEntry,
    `The supplied CLI does not contain ${wrapperRuleName}; build the fork first`,
  );
  assert.equal(wrapperEntry.category, "restriction");
  assert.equal(wrapperEntry.type_aware, false);
  assert.equal(wrapperEntry.fix, "none");
  assert.equal(wrapperEntry.docs_url, wrapperDocumentation);
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

  const ruleSchemas = schema.definitions.DummyRuleMap.properties;
  assert.deepEqual(
    ruleSchemas[wrapperRuleName],
    ruleSchemas["class-methods-use-this"],
    "The wrapper must expose exactly the upstream rule's configuration schema",
  );
  assert.deepEqual(Object.keys(schema.definitions.ClassMethodsUseThisConfig.properties).sort(), [
    "enforceForClassFields",
    "exceptMethods",
    "ignoreClassesWithImplements",
    "ignoreOverrideMethods",
  ]);
  const wrapperConfiguration = {
    ...configuration,
    rules: {
      "class-methods-use-this": "off",
      [wrapperRuleName]: ["error", wrapperDefaults],
      [ruleName]: "error",
    },
  };
  assert.ok(
    validate(JSON.parse(JSON.stringify(wrapperConfiguration))),
    JSON.stringify(validate.errors),
  );
  for (const options of [
    { ...wrapperDefaults, ignoreClassesWithImplements: "all" },
    { ...wrapperDefaults, ignoreClassesWithImplements: "public-fields" },
  ]) {
    assert.ok(
      validate(
        JSON.parse(
          JSON.stringify({
            ...wrapperConfiguration,
            rules: { [wrapperRuleName]: ["error", options] },
          }),
        ),
      ),
      JSON.stringify(validate.errors),
    );
  }
  for (const options of [
    { enforceForClassFields: "true" },
    { exceptMethods: [42] },
    { ignoreOverrideMethods: "false" },
    { ignoreClassesWithImplements: "unknown" },
    { unknownOption: true },
  ]) {
    assert.equal(
      validate({ ...configuration, rules: { [wrapperRuleName]: ["error", options] } }),
      false,
      JSON.stringify(options),
    );
  }
  write(
    "wrapper.config.ts",
    `import { defineConfig } from 'oxlint'
export default defineConfig({
  plugins: ['nestjs'],
  categories: ${JSON.stringify(categories)},
  rules: {
    'class-methods-use-this': 'off',
    '${wrapperRuleName}': ['error', {
      enforceForClassFields: true,
      exceptMethods: [],
      ignoreOverrideMethods: false,
      ignoreClassesWithImplements: undefined,
    }],
    '${ruleName}': 'error',
  },
})
`,
  );

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
const wrapper: OxlintConfig = defineConfig({ plugins: ['nestjs'], rules: {
  'class-methods-use-this': 'off',
  '${wrapperRuleName}': ['error', { enforceForClassFields: false, exceptMethods: ['helper', '#privateHelper'], ignoreOverrideMethods: true, ignoreClassesWithImplements: 'public-fields' }],
  '${ruleName}': 'error',
} })
defineConfig({ rules: { '${wrapperRuleName}': ['error', { ignoreClassesWithImplements: 'all' }] } })
// @ts-expect-error The wrapper retains strict upstream option value types.
defineConfig({ rules: { '${wrapperRuleName}': ['error', { enforceForClassFields: 'true' }] } })
// @ts-expect-error The wrapper does not invent additional options.
defineConfig({ rules: { '${wrapperRuleName}': ['error', { unknownOption: true }] } })
void wrapper
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
      files: ["types.ts", "oxlint.config.ts", "wrapper.config.ts"],
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

  const wrapperFixtures = [
    [
      "instance",
      "import { Get } from '@nestjs/common'; class C { @Get() handler() { return 'ok' } }",
      0,
    ],
    ["auxiliary", "class C { helper() { return 'ok' } }", 1],
    [
      "literal-method-name",
      "import { Get } from '@nestjs/common'; class C { @Get() ['handler']() { return 'ok' } }",
      0,
    ],
    [
      "template-method-name",
      'import { Get } from "@nestjs/common"; class C { @Get() [`handler`]() { return "ok" } }',
      0,
    ],
    [
      "symbol-method-name",
      "import { Get } from '@nestjs/common'; class C { @Get() [Symbol.iterator]() { return 'ok' } }",
      1,
    ],
    [
      "constructor-method-name",
      "import { Get } from '@nestjs/common'; class C { @Get() ['constructor']() { return 'ok' } }",
      1,
    ],
    [
      "dynamic-method-name",
      "import { Get } from '@nestjs/common'; const dynamicName = 'handler'; class C { @Get() [dynamicName]() { return 'ok' } }",
      1,
    ],
    [
      "private-name",
      "import { Get } from '@nestjs/common'; class C { @Get() #handler() { return 'ok' } }",
      1,
    ],
    [
      "typescript-private",
      "import { Get } from '@nestjs/common'; class C { @Get() private handler() { return 'ok' } }",
      0,
    ],
    [
      "typescript-protected",
      "import { Get } from '@nestjs/common'; class C { @Get() protected handler() { return 'ok' } }",
      0,
    ],
    [
      "controller-not-exempt",
      "import { Controller, Get } from '@nestjs/common'; @Controller() class C { @Get() handler() { return 'ok' } helper() { return 'ok' } }",
      1,
    ],
    [
      "aliased",
      "import { Get as Route } from '@nestjs/common'; class C { @Route() handler() { return 'ok' } }",
      0,
    ],
    [
      "namespace",
      "import * as Nest from '@nestjs/common'; class C { @Nest.Get() handler() { return 'ok' } }",
      0,
    ],
    [
      "namespace-string",
      "import * as Nest from '@nestjs/common'; class C { @(Nest['Get']()) handler() { return 'ok' } }",
      0,
    ],
    [
      "namespace-template",
      'import * as Nest from "@nestjs/common"; class C { @(Nest[`Get`]()) handler() { return "ok" } }',
      0,
    ],
    [
      "shadowed-name",
      "import { Get } from '@nestjs/common'; function nested(Get: () => MethodDecorator) { return class C { @Get() handler() { return 'ok' } } }",
      1,
    ],
    [
      "shadowed-namespace",
      "import * as Nest from '@nestjs/common'; function nested(Nest: { Get: () => MethodDecorator }) { return class C { @Nest.Get() handler() { return 'ok' } } }",
      1,
    ],
    [
      "handler-parameter",
      "import { Get } from '@nestjs/common'; class C { @Get() handler(Get: string) { return Get } }",
      0,
    ],
    [
      "foreign-import",
      "import { Get } from 'other-framework'; class C { @Get() handler() { return 'ok' } }",
      1,
    ],
    ["local-name", "const Get = () => () => {}; class C { @Get() handler() { return 'ok' } }", 1],
    [
      "type-import",
      "import type { Get } from '@nestjs/common'; class C { @Get() handler() { return 'ok' } }",
      1,
    ],
    [
      "type-specifier",
      "import { type Get } from '@nestjs/common'; class C { @Get() handler() { return 'ok' } }",
      1,
    ],
    [
      "namespace-type-import",
      "import type * as Nest from '@nestjs/common'; class C { @Nest.Get() handler() { return 'ok' } }",
      1,
    ],
    [
      "non-http",
      "import { Header, HttpCode } from '@nestjs/common'; class C { @Header('x-test', 'yes') @HttpCode(200) handler() { return 'ok' } }",
      1,
    ],
    [
      "base-class",
      "import { Get } from '@nestjs/common'; abstract class Base { @Get() handler() { return 'ok' } } class C extends Base {}",
      0,
    ],
    [
      "mixin",
      "import { Get } from '@nestjs/common'; function mixin(Base: new () => object) { return class extends Base { @Get() handler() { return 'ok' } } }",
      0,
    ],
    [
      "class-expression",
      "import { Get } from '@nestjs/common'; export const C = class { @Get() handler() { return 'ok' } }",
      0,
    ],
    [
      "getter",
      "import { Get } from '@nestjs/common'; class C { @Get() get handler() { return 'ok' } }",
      1,
    ],
    [
      "setter",
      "import { Get } from '@nestjs/common'; class C { @Get() set handler(value: string) { void value } }",
      1,
    ],
    ["field", "import { Get } from '@nestjs/common'; class C { @Get() handler = () => 'ok' }", 1],
    [
      "auto-accessor",
      "import { Get } from '@nestjs/common'; class C { @Get() accessor handler = () => 'ok' }",
      1,
    ],
    [
      "assigned-alias",
      "import { Get } from '@nestjs/common'; const Route = Get; class C { @Route() handler() { return 'ok' } }",
      1,
    ],
    [
      "dynamic-namespace",
      "import * as Nest from '@nestjs/common'; const key = 'Get'; class C { @(Nest[key]()) handler() { return 'ok' } }",
      1,
    ],
    [
      "default-import",
      "import Nest from '@nestjs/common'; class C { @Nest.Get() handler() { return 'ok' } }",
      1,
    ],
    ["stateful-helper", "class C { value = 'ok'; helper() { return this.value } }", 0],
    ["static-helper", "class C { static helper() { return 'ok' } }", 0],
  ];
  for (const decorator of decorators) {
    wrapperFixtures.push([
      `decorator-${decorator}`,
      `import { ${decorator} as Route } from '@nestjs/common'; class C { @Route() handler() { return 'ok' } }`,
      0,
    ]);
  }
  for (const [name, source, expectedCount] of wrapperFixtures) {
    const file = `wrapper-${name}.ts`;
    write(file, `${source}\n`);
    lint(file, expectedCount, "wrapper.config.ts", [], Array(expectedCount).fill(wrapperCode));
  }
  lint("runtime-http.ts", 1, "wrapper.config.ts");
  write(
    "wrapper-mixed.ts",
    "import { Get } from '@nestjs/common'; class C { @Get() static handler() { return 'ok' } helper() { return 'ok' } }\n",
  );
  lint("wrapper-mixed.ts", 2, "wrapper.config.ts", [], ["nestjs(no-static-handlers)", wrapperCode]);
  log(
    `${wrapperFixtures.length + 2} combined wrapper fixtures: only instance HTTP methods are exempt; helpers, shadowed bindings, accessors and fields retain their checks`,
  );

  const exceptionSource = "class C { helper() { return 1 } #helper() { return 2 } }";
  const fieldSource = "class C { arrow = () => 1; callback = function () { return 2 } }";
  const overrideSource =
    "class Base { helper() { return this } } class C extends Base { override helper() { return 1 } }";
  const overrideFieldSource =
    "class Base { handler = () => this } class C extends Base { override handler = () => 1 }";
  const implementsSource =
    "interface Port { work(): number } class C implements Port { work() { return 1 } protected helper() { return 2 } private internal() { return 3 } #secret() { return 4 } field = () => 5 }";
  /** @type {Array<[string, string, Record<string, unknown> | undefined, number]>} */
  const parityCases = [
    ["omitted-options", "class C { helper() { return 1 } }", undefined, 1],
    ["explicit-defaults", "class C { helper() { return 1 } }", wrapperDefaults, 1],
    ["empty-options", "class C { helper() { return 1 } }", {}, 1],
    ["fields-default", fieldSource, undefined, 2],
    ["fields-enabled", fieldSource, { enforceForClassFields: true }, 2],
    ["fields-disabled", fieldSource, { enforceForClassFields: false }, 0],
    ["accessor-field-default", "class C { accessor handler = () => 1 }", undefined, 1],
    [
      "accessor-field-disabled",
      "class C { accessor handler = () => 1 }",
      { enforceForClassFields: false },
      0,
    ],
    [
      "decorated-field-enabled",
      "import { Get } from '@nestjs/common'; class C { @Get() handler = () => 1 }",
      { enforceForClassFields: true },
      1,
    ],
    [
      "decorated-field-disabled",
      "import { Get } from '@nestjs/common'; class C { @Get() handler = () => 1 }",
      { enforceForClassFields: false },
      0,
    ],
    ["exceptions-default", exceptionSource, undefined, 2],
    ["except-public", exceptionSource, { exceptMethods: ["helper"] }, 1],
    ["except-private", exceptionSource, { exceptMethods: ["#helper"] }, 1],
    ["except-both", exceptionSource, { exceptMethods: ["helper", "#helper"] }, 0],
    ["override-default", overrideSource, undefined, 1],
    ["override-enabled", overrideSource, { ignoreOverrideMethods: true }, 0],
    ["override-disabled", overrideSource, { ignoreOverrideMethods: false }, 1],
    ["override-field-default", overrideFieldSource, undefined, 1],
    ["override-field-ignored", overrideFieldSource, { ignoreOverrideMethods: true }, 0],
    ["implements-default", implementsSource, undefined, 5],
    ["implements-all", implementsSource, { ignoreClassesWithImplements: "all" }, 0],
    [
      "implements-public-fields",
      implementsSource,
      { ignoreClassesWithImplements: "public-fields" },
      3,
    ],
    [
      "without-implements",
      "class C { helper() { return 1 } }",
      { ignoreClassesWithImplements: "all" },
      1,
    ],
    [
      "all-options",
      implementsSource,
      {
        enforceForClassFields: false,
        exceptMethods: ["helper", "#secret"],
        ignoreOverrideMethods: true,
        ignoreClassesWithImplements: "public-fields",
      },
      1,
    ],
  ];
  for (const [name, source, options, expectedCount] of parityCases) {
    const file = `parity-${name}.ts`;
    write(file, `${source}\n`);
    const severity = options === undefined ? "error" : ["error", options];
    for (const [config, selectedRule] of [
      ["parity-base.config.ts", "class-methods-use-this"],
      ["parity-wrapper.config.ts", wrapperRuleName],
    ]) {
      write(
        config,
        `import { defineConfig } from 'oxlint'\nexport default defineConfig(${JSON.stringify({ plugins: ["nestjs"], categories, rules: { "class-methods-use-this": "off", [wrapperRuleName]: "off", [ruleName]: "off", [selectedRule]: severity } })})\n`,
      );
    }
    const base = lint(
      file,
      expectedCount,
      "parity-base.config.ts",
      [],
      Array(expectedCount).fill(baseCode),
    );
    const wrapper = lint(
      file,
      expectedCount,
      "parity-wrapper.config.ts",
      [],
      Array(expectedCount).fill(wrapperCode),
    );
    const details = (report) =>
      report.diagnostics.map(({ code: _code, url: _url, ...diagnostic }) => diagnostic);
    assert.deepEqual(
      details(wrapper),
      details(base),
      `Native wrapper changed upstream behavior for ${name}`,
    );
  }
  log(
    `${parityCases.length} option parity cases match upstream counts, messages, help and source spans across all four options and defaults`,
  );

  for (const extra of [["--fix"], ["--fix-suggestions"], ["--fix-dangerously"]]) {
    const before = readFileSync(join(consumer, "wrapper-auxiliary.ts"), "utf8");
    lint("wrapper-auxiliary.ts", 1, "wrapper.config.ts", extra, [wrapperCode]);
    assert.equal(readFileSync(join(consumer, "wrapper-auxiliary.ts"), "utf8"), before);
  }
  const wrapperSarif = JSON.parse(
    run(
      process.execPath,
      [cli, "--config", "wrapper.config.ts", "--format", "sarif", "wrapper-auxiliary.ts"],
      1,
    ),
  );
  const wrapperSarifRule = wrapperSarif.runs[0].tool.driver.rules.find((item) =>
    item.id.includes("class-methods-use-this"),
  );
  assert.equal(wrapperSarifRule?.helpUri, wrapperDocumentation);
  log(
    "wrapper metadata, JSON/SARIF documentation and all fix modes preserve the upstream diagnostic without autofix",
  );
  process.stdout.write("All native Nest HTTP handler integration checks passed.\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
