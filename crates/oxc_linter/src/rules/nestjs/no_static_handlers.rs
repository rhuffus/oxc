use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};

use crate::{AstNode, context::LintContext, rule::Rule, utils::is_nestjs_http_handler_decorator};

fn no_static_handlers_diagnostic(span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn("NestJS HTTP handlers must be instance methods.")
        .with_help("Declare this handler as an instance method and review calls through the class. NestJS discovers HTTP handlers on the instance prototype.")
        .with_label(span)
}

#[derive(Debug, Default, Clone)]
pub struct NoStaticHandlers;

declare_oxc_lint!(
    /// ### What it does
    ///
    /// Disallows static methods decorated with an HTTP route decorator imported from `@nestjs/common`.
    ///
    /// ### Why is this bad?
    ///
    /// NestJS discovers HTTP handlers on the controller instance's prototype chain. A static method belongs to the class constructor, so its HTTP decorator does not register a route through normal controller discovery. The method can still be called directly in JavaScript, which can hide the missing HTTP endpoint in tests that do not make real requests.
    ///
    /// The method does not have to use `this`: an instance method may legitimately return a constant or only adapt request and response data. This rule checks the `static` modifier, not whether the body uses instance state.
    ///
    /// ### Examples
    ///
    /// Examples of **incorrect** code for this rule:
    ///
    /// ```typescript
    /// import { Get } from '@nestjs/common';
    ///
    /// class StatusController {
    ///   @Get('status')
    ///   static status() {
    ///     return 'ready';
    ///   }
    /// }
    /// ```
    ///
    /// Examples of **correct** code for this rule:
    ///
    /// ```typescript
    /// import { Get } from '@nestjs/common';
    ///
    /// class StatusController {
    ///   @Get('status')
    ///   status() {
    ///     return 'ready';
    ///   }
    ///
    ///   static formatStatus(status: string) {
    ///     return status.toUpperCase();
    ///   }
    /// }
    /// ```
    ///
    /// ### Scope and limitations
    ///
    /// Recognizes calls to `RequestMapping`, `Get`, `Post`, `Delete`, `Put`, `Patch`, `Options`, `Head`, `All`, `Search`, `QueryMethod`, `Propfind`, `Proppatch`, `Mkcol`, `Copy`, `Move`, `Lock`, `Unlock`, and `Sse`. Named import aliases and namespace imports are supported, including namespace properties written as string literals or template literals without substitutions. The import must be a value import from exactly `@nestjs/common`; shadowed bindings, local lookalikes, type-only imports, and imports from other modules are ignored.
    ///
    /// A class does not need its own `@Controller` decorator: methods declared on base classes or in mixins are also checked. Only method declarations are checked; decorated class fields and accessors declared with the `accessor` keyword are outside this rule's scope.
    ///
    /// Static getters and setters with an HTTP decorator are also reported and must be converted to ordinary instance methods. Removing only `static` is insufficient because NestJS does not discover getters or setters as HTTP handlers. This rule does not validate non-static decorator targets.
    ///
    /// This rule does not follow re-exports, CommonJS imports, assignments such as `const Route = Get`, custom decorators built with `applyDecorators`, or dynamically computed namespace properties, including properties stored in a `const` variable. It does not inspect GraphQL, WebSocket, or microservice handlers. Removing `static` can require changes to callers, so no automatic fix is provided.
    ///
    /// See NestJS's [HTTP decorators](https://github.com/nestjs/nest/blob/v12.0.1/packages/common/decorators/http/request-mapping.decorator.ts) and [prototype scanner](https://github.com/nestjs/nest/blob/v12.0.1/packages/core/metadata-scanner.ts).
    NoStaticHandlers,
    nestjs,
    correctness,
    version = "1.82.0-nestjs.2",
    short_description = "Disallow static NestJS HTTP handlers.",
);

impl Rule for NoStaticHandlers {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::MethodDefinition(method) = node.kind() else {
            return;
        };
        if !method.r#static || method.decorators.is_empty() {
            return;
        }

        if method
            .decorators
            .iter()
            .any(|decorator| is_nestjs_http_handler_decorator(&decorator.expression, ctx))
        {
            ctx.diagnostic(no_static_handlers_diagnostic(method.key.span()));
        }
    }
}

#[test]
fn test() {
    use crate::tester::Tester;

    let pass = vec![
        "class Controller { static handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() handler(Get: string) { return Get; } }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() get handler() { return 'ready'; } }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() set handler(value: string) {} }",
        "import * as nest from '@nestjs/common'; class Controller { @nest.Get() handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { static helper() { return Get; } }",
        "import { HttpCode, Header, UseGuards } from '@nestjs/common'; class Controller { @HttpCode(200) @Header('x-test', 'value') @UseGuards(Guard) static handler() {} }",
        // Matching names are insufficient: the decorator must resolve to the NestJS import.
        "class Controller { @Get() static handler() {} }",
        "function Get() {} class Controller { @Get() static handler() {} }",
        "const nest = { Get() {} }; class Controller { @nest.Get() static handler() {} }",
        "import { Get } from 'another-framework'; class Controller { @Get() static handler() {} }",
        "import * as nest from 'another-framework'; class Controller { @nest.Get() static handler() {} }",
        "import { Get } from '@nestjs/common/decorators'; class Controller { @Get() static handler() {} }",
        "import { UseGuards as Get } from '@nestjs/common'; class Controller { @Get() static handler() {} }",
        "import Get from '@nestjs/common'; class Controller { @Get() static handler() {} }",
        "import nest from '@nestjs/common'; class Controller { @nest.Get() static handler() {} }",
        "import { Get as nest } from '@nestjs/common'; class Controller { @nest.Get() static handler() {} }",
        // Type-only imports do not provide a runtime decorator binding.
        "import type { Get } from '@nestjs/common'; class Controller { @Get() static handler() {} }",
        "import { type Get } from '@nestjs/common'; class Controller { @Get() static handler() {} }",
        "import type { Get as Route } from '@nestjs/common'; class Controller { @Route() static handler() {} }",
        "import { type Get as Route } from '@nestjs/common'; class Controller { @Route() static handler() {} }",
        "import type * as nest from '@nestjs/common'; class Controller { @nest.Get() static handler() {} }",
        // The nearest binding wins, including in mixins and class expressions.
        "import { Get } from '@nestjs/common'; function mixin(Get: any) { return class { @Get() static handler() {} }; }",
        "import * as nest from '@nestjs/common'; function mixin(nest: any) { return class { @nest.Get() static handler() {} }; }",
        "import { Get } from '@nestjs/common'; { const Get = () => {}; class Controller { @Get() static handler() {} } }",
        "import { Get } from '@nestjs/common'; const Controller = class Get { @Get() static handler() {} };",
        // Deliberately do not follow indirect references or custom decorator composition.
        "import { Get } from './decorators'; class Controller { @Get() static handler() {} }",
        "import { Get } from '@nestjs/common'; const Route = Get; class Controller { @Route() static handler() {} }",
        "import * as nest from '@nestjs/common'; const alias = nest; class Controller { @alias.Get() static handler() {} }",
        "import { Get, applyDecorators } from '@nestjs/common'; class Controller { @applyDecorators(Get()) static handler() {} }",
        "import { Get, applyDecorators } from '@nestjs/common'; const Route = () => applyDecorators(Get()); class Controller { @Route() static handler() {} }",
        "const { Get } = require('@nestjs/common'); class Controller { @Get() static handler() {} }",
        "import nest = require('@nestjs/common'); class Controller { @nest.Get() static handler() {} }",
        "import * as nest from '@nestjs/common'; const key = 'Get'; class Controller { @(nest[key]()) static handler() {} }",
        "import * as nest from '@nestjs/common'; class Controller { @(nest[`G${'et'}`]()) static handler() {} }",
        "import * as nest from '@nestjs/common'; class Controller { @nest.http.Get() static handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get.bind(null) static handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get static handler() {} }",
        // Only route factories are recognized, and this rule is restricted to method nodes.
        "import * as nest from '@nestjs/common'; class Controller { @nest.Query() static handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() static handler = () => {}; }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() static accessor handler = () => {}; }",
    ];

    let fail = vec![
        "import { Controller, Get } from '@nestjs/common'; @Controller() class StatusController { @Get('status') static status() { return 'ready'; } }",
        "import { Get as Route } from '@nestjs/common'; class Controller { @Route() static handler() {} }",
        "import { Post as Get } from '@nestjs/common'; class Controller { @Get() static handler() {} }",
        "import { 'Get' as Route } from '@nestjs/common'; class Controller { @Route() static handler() {} }",
        "import * as nest from '@nestjs/common'; class Controller { @nest.Get() static handler() {} }",
        "import * as nest from '@nestjs/common'; class Controller { @(nest['Get']()) static handler() {} }",
        "import * as nest from '@nestjs/common'; class Controller { @(nest[`Get`]()) static handler() {} }",
        "import * as nest from '@nestjs/common'; class Controller { @(nest['G\\u0065t']()) static handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @((Get)()) static handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() static async handler() { return 'ready'; } }",
        "import { Sse } from '@nestjs/common'; class Controller { @Sse('events') static *handler() { yield 'ready'; } }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() static ['handler']() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() public static handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() static handler() { return this; } }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() static handler(Get: string) { return Get; } }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() static get handler() { return 'ready'; } }",
        "import { Get, Post } from '@nestjs/common'; class Controller { @Get() @Post() static set handler(value: string) {} }",
        // Decorators on base classes and mixin methods count without a local @Controller.
        "import { Get } from '@nestjs/common'; class Base { @Get() static handler() {} } class Controller extends Base {}",
        "import { Get } from '@nestjs/common'; const Controller = class { @Get() static handler() {} };",
        "import { Get } from '@nestjs/common'; function mixin() { return class { @Get() static handler() {} }; }",
        "import { Get as Route } from '@nestjs/common'; function mixin(Get: any) { return class { @Route() static handler() {} }; }",
        // Non-HTTP decorators do not hide a route; report a method only once.
        "import { Get, HttpCode } from '@nestjs/common'; class Controller { @HttpCode(200) @Get() static handler() {} }",
        "import { Get, Post } from '@nestjs/common'; class Controller { @Get() @Post() static handler() {} }",
    ];

    Tester::new(NoStaticHandlers::NAME, NoStaticHandlers::PLUGIN, pass, fail)
        .change_rule_path_extension("ts")
        .test_and_snapshot();
}

#[test]
fn test_all_http_decorators() {
    use crate::tester::Tester;

    // Keep this independent of the production matcher so omissions fail a test.
    // NestJS 12: request-mapping.decorator.ts plus sse.decorator.ts.
    let decorators = [
        "RequestMapping",
        "Get",
        "Post",
        "Delete",
        "Put",
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
    let mut pass = Vec::new();
    let mut fail = Vec::new();
    for decorator in decorators {
        pass.push(format!(
            "import {{ {decorator} }} from '@nestjs/common'; class Controller {{ @{decorator}() handler() {{}} }}"
        ));
        fail.push(format!(
            "import {{ {decorator} }} from '@nestjs/common'; class Controller {{ @{decorator}() static handler() {{}} }}"
        ));
        fail.push(format!(
            "import {{ {decorator} as Route }} from '@nestjs/common'; class Controller {{ @Route() static handler() {{}} }}"
        ));
        fail.push(format!(
            "import * as nest from '@nestjs/common'; class Controller {{ @nest.{decorator}() static handler() {{}} }}"
        ));
        fail.push(format!(
            "import * as nest from '@nestjs/common'; class Controller {{ @(nest['{decorator}']()) static handler() {{}} }}"
        ));
    }

    Tester::new(NoStaticHandlers::NAME, NoStaticHandlers::PLUGIN, pass, fail)
        .change_rule_path_extension("ts")
        .test();
}
