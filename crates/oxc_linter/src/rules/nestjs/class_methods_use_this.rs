use oxc_ast::AstKind;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode, context::LintContext, rule::Rule,
    rules::eslint::class_methods_use_this::ClassMethodsUseThis as EslintClassMethodsUseThis,
    utils::is_nestjs_http_handler_decorator,
};

#[derive(Debug, Default, Clone)]
pub struct ClassMethodsUseThis(EslintClassMethodsUseThis);

declare_oxc_lint!(
    /// ### What it does
    ///
    /// Enforces ESLint's `class-methods-use-this` behavior while exempting ordinary instance methods decorated as NestJS HTTP handlers.
    ///
    /// ### Why is this bad?
    ///
    /// Methods that do not use instance state can often be static, but NestJS discovers HTTP handlers on the instance prototype. A valid handler may return a constant or only adapt HTTP request and response data without using `this`. Converting it to a static method prevents normal route discovery.
    ///
    /// This rule delegates to Oxlint's ESLint implementation and reuses its configuration schema, defaults, and option parsing. Only the HTTP instance-method exception is added. Enable `nestjs/no-static-handlers` alongside this rule to reject static HTTP handlers, and disable the original `class-methods-use-this` rule to avoid contradictory diagnostics.
    ///
    /// ### Examples
    ///
    /// Examples of **incorrect** code for this rule:
    ///
    /// ```typescript
    /// class Helper {
    ///   formatStatus(status: string) {
    ///     return status.toUpperCase();
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
    /// The HTTP decorator matcher is shared with `nestjs/no-static-handlers`: it recognizes the 19 HTTP factories imported by name or namespace from exactly `@nestjs/common`, including named aliases and statically known namespace properties. Import bindings are resolved semantically, so local lookalikes, shadowed imports, type-only imports, and imports from other modules do not create an exception. Base classes and mixins do not need their own `@Controller` decorator.
    ///
    /// Only ordinary instance methods with a statically known, non-private JavaScript name other than `constructor` are exempted. String and numeric literal names and template literal names without substitutions are supported. Symbol keys, dynamically computed names, JavaScript private methods such as `#handler`, getters, setters, class fields, and members declared with `accessor` retain the original rule's behavior, even when decorated with an HTTP factory. TypeScript `private` and `protected` modifiers do not prevent the exception because these methods are emitted on the prototype. Static members also retain the original behavior and are checked separately by `nestjs/no-static-handlers`.
    ///
    /// Re-exports, CommonJS imports, assigned aliases, custom decorators, and dynamic namespace properties are not followed. Other NestJS contracts, including providers, guards, hooks, GraphQL, WebSockets, and microservices, receive no additional exception. The rule does not verify that a class or route is registered in a NestJS application.
    ///
    /// See NestJS's [route discovery](https://github.com/nestjs/nest/blob/v12.0.1/packages/core/router/paths-explorer.ts) and [prototype scanner](https://github.com/nestjs/nest/blob/v12.0.1/packages/core/metadata-scanner.ts).
    ClassMethodsUseThis,
    nestjs,
    restriction,
    config = crate::rules::eslint::class_methods_use_this::ClassMethodsUseThisConfig,
    version = "1.82.0-nestjs.3",
    short_description = "Require this in class methods, except NestJS HTTP instance handlers.",
);

impl Rule for ClassMethodsUseThis {
    fn from_configuration(value: serde_json::Value) -> Result<Self, serde_json::error::Error> {
        EslintClassMethodsUseThis::from_configuration(value).map(Self)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::MethodDefinition(method) => {
                if !method.r#static
                    && method.kind.is_method()
                    && !method.key.is_private_identifier()
                    && !method.decorators.is_empty()
                    && method.key.static_name().is_some_and(|name| name != "constructor")
                    && method.decorators.iter().any(|decorator| {
                        is_nestjs_http_handler_decorator(&decorator.expression, ctx)
                    })
                {
                    return;
                }
            }
            // Keep these node kinds explicit so generated dispatch preserves the base rule's
            // checks for function-valued fields and auto-accessors.
            AstKind::PropertyDefinition(_) | AstKind::AccessorProperty(_) => {}
            _ => return,
        }
        self.0.run(node, ctx);
    }
}

#[test]
fn test_generated_dispatch_node_types() {
    use oxc_ast::AstType;

    let node_types = <ClassMethodsUseThis as RuleRunner>::NODE_TYPES
        .expect("The wrapper must dispatch only to class members, not every AST node");
    assert!(node_types.has(AstType::MethodDefinition));
    assert!(node_types.has(AstType::PropertyDefinition));
    assert!(node_types.has(AstType::AccessorProperty));
    assert_eq!(node_types.into_iter().count(), 3);
}

#[test]
fn test_http_handler_exception() {
    use crate::tester::Tester;

    let pass = vec![
        "import { Get } from '@nestjs/common'; class Controller { @Get() handler() { return 'ready'; } }",
        "import { Get as Route } from '@nestjs/common'; class Controller { @Route() handler() {} }",
        "import { 'Get' as Route } from '@nestjs/common'; class Controller { @Route() handler() {} }",
        "import { Post as Get } from '@nestjs/common'; class Controller { @Get() handler() {} }",
        "import * as nest from '@nestjs/common'; class Controller { @nest.Get() handler() {} }",
        "import * as nest from '@nestjs/common'; class Controller { @(nest['Get']()) handler() {} }",
        "import * as nest from '@nestjs/common'; class Controller { @(nest[`Get`]()) handler() {} }",
        "import * as nest from '@nestjs/common'; class Controller { @((nest).Get()) handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @((Get)()) handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() handler(Get: string) { return Get; } }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() private handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() protected handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() ['handler']() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() [`handler`]() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() 42() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() [42]() {} }",
        "import { Get } from '@nestjs/common'; abstract class Base { @Get() handler() {} } class Controller extends Base {}",
        "import { Get } from '@nestjs/common'; const Controller = class { @Get() handler() {} };",
        "import { Get } from '@nestjs/common'; function mixin() { return class { @Get() handler() {} }; }",
        "import { Get as Route } from '@nestjs/common'; function mixin(Get: any) { return class { @Route() handler() {} }; }",
        "import { Get, Post, HttpCode } from '@nestjs/common'; class Controller { @Get() @Post() @HttpCode(200) handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() async handler() { return 'ready'; } }",
        "import { Sse } from '@nestjs/common'; class Controller { @Sse() *handler() { yield 'ready'; } }",
        // The companion no-static-handlers rule is responsible for this invalid HTTP target.
        "import { Get } from '@nestjs/common'; class Controller { @Get() static handler() {} }",
    ];
    let fail = vec![
        "import { Get } from '@nestjs/common'; class Controller { @Get() handler() {} helper() {} }",
        "class Controller { @Get() handler() {} }",
        "function Get() {} class Controller { @Get() handler() {} }",
        "const nest = { Get: () => () => {} }; class Controller { @nest.Get() handler() {} }",
        "import { Get } from 'another-framework'; class Controller { @Get() handler() {} }",
        "import * as nest from 'another-framework'; class Controller { @nest.Get() handler() {} }",
        "import { Get } from '@nestjs/common/decorators'; class Controller { @Get() handler() {} }",
        "import { Get } from './decorators'; class Controller { @Get() handler() {} }",
        "import { UseGuards as Get } from '@nestjs/common'; class Controller { @Get() handler() {} }",
        "import Get from '@nestjs/common'; class Controller { @Get() handler() {} }",
        "import nest from '@nestjs/common'; class Controller { @nest.Get() handler() {} }",
        "import { Get as nest } from '@nestjs/common'; class Controller { @nest.Get() handler() {} }",
        "import type { Get } from '@nestjs/common'; class Controller { @Get() handler() {} }",
        "import { type Get } from '@nestjs/common'; class Controller { @Get() handler() {} }",
        "import type { Get as Route } from '@nestjs/common'; class Controller { @Route() handler() {} }",
        "import { type Get as Route } from '@nestjs/common'; class Controller { @Route() handler() {} }",
        "import type * as nest from '@nestjs/common'; class Controller { @nest.Get() handler() {} }",
        "import { Get } from '@nestjs/common'; function mixin(Get: any) { return class { @Get() handler() {} }; }",
        "import * as nest from '@nestjs/common'; function mixin(nest: any) { return class { @nest.Get() handler() {} }; }",
        "import { Get } from '@nestjs/common'; { const Get = () => {}; class Controller { @Get() handler() {} } }",
        "import { Get } from '@nestjs/common'; const Controller = class Get { @Get() handler() {} };",
        "import { Get } from '@nestjs/common'; const Route = Get; class Controller { @Route() handler() {} }",
        "import * as nest from '@nestjs/common'; const alias = nest; class Controller { @alias.Get() handler() {} }",
        "import { Get, applyDecorators } from '@nestjs/common'; class Controller { @applyDecorators(Get()) handler() {} }",
        "const { Get } = require('@nestjs/common'); class Controller { @Get() handler() {} }",
        "import nest = require('@nestjs/common'); class Controller { @nest.Get() handler() {} }",
        "import * as nest from '@nestjs/common'; const key = 'Get'; class Controller { @(nest[key]()) handler() {} }",
        "import * as nest from '@nestjs/common'; class Controller { @(nest[`G${'et'}`]()) handler() {} }",
        "import * as nest from '@nestjs/common'; class Controller { @nest.http.Get() handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get.bind(null) handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get handler() {} }",
        "import { HttpCode, Header, UseGuards } from '@nestjs/common'; class Controller { @HttpCode(200) @Header('x', 'y') @UseGuards(Guard) handler() {} }",
        // These are not ordinary methods and do not qualify for the HTTP exception.
        "import { Get } from '@nestjs/common'; class Controller { @Get() get handler() { return 'ready'; } }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() set handler(value: string) {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() handler = () => 'ready'; }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() handler = function() { return 'ready'; }; }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() accessor handler = () => 'ready'; }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() accessor handler = function() { return 'ready'; }; }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() #handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() [Symbol.iterator]() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() ['constructor']() {} }",
        "import { Get } from '@nestjs/common'; const dynamicName = 'handler'; class Controller { @Get() [dynamicName]() {} }",
    ];
    Tester::new(ClassMethodsUseThis::NAME, ClassMethodsUseThis::PLUGIN, pass, fail)
        .change_rule_path_extension("ts")
        .test_and_snapshot();
}

#[test]
fn test_all_http_decorators() {
    use crate::tester::Tester;

    // Independent catalog: omissions from the shared matcher must fail this test.
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
    for decorator in decorators {
        pass.push(format!(
            "import {{ {decorator} }} from '@nestjs/common'; class Controller {{ @{decorator}() handler() {{}} }}"
        ));
        pass.push(format!(
            "import {{ {decorator} as Route }} from '@nestjs/common'; class Controller {{ @Route() handler() {{}} }}"
        ));
        pass.push(format!(
            "import * as nest from '@nestjs/common'; class Controller {{ @nest.{decorator}() handler() {{}} }}"
        ));
        pass.push(format!(
            "import * as nest from '@nestjs/common'; class Controller {{ @(nest['{decorator}']()) handler() {{}} }}"
        ));
    }
    Tester::new(ClassMethodsUseThis::NAME, ClassMethodsUseThis::PLUGIN, pass, vec![])
        .change_rule_path_extension("ts")
        .test();
}

#[test]
fn test_upstream_behavior_and_option_parity() {
    use crate::tester::Tester;
    use serde_json::json;

    let pass = vec![
        ("class Helper { constructor() {} }", None),
        ("abstract class Helper { abstract method(): void; }", None),
        ("class Helper { static method() {} }", None),
        ("class Helper { method() { return this.value; } }", None),
        ("class Helper extends Base { method() { return super.method(); } }", None),
        ("class Helper { method() { return () => this.value; } }", None),
        ("class Helper { method = () => this.value; }", None),
        ("class Helper { accessor method = () => this.value; }", None),
        ("class Helper { method() {} }", Some(json!([{ "exceptMethods": ["method"] }]))),
        ("class Helper { #method() {} }", Some(json!([{ "exceptMethods": ["#method"] }]))),
        ("class Helper { 'method'() {} }", Some(json!([{ "exceptMethods": ["method"] }]))),
        ("class Helper { method = () => {}; }", Some(json!([{ "enforceForClassFields": false }]))),
        (
            "class Helper { method = function() {}; }",
            Some(json!([{ "enforceForClassFields": false }])),
        ),
        (
            "class Helper { accessor method = () => {}; }",
            Some(json!([{ "enforceForClassFields": false }])),
        ),
        (
            "class Helper { accessor method = function() {}; }",
            Some(json!([{ "enforceForClassFields": false }])),
        ),
        (
            "class Helper extends Base { override method() {} }",
            Some(json!([{ "ignoreOverrideMethods": true }])),
        ),
        (
            "class Helper extends Base { override method = () => {}; }",
            Some(json!([{ "ignoreOverrideMethods": true }])),
        ),
        (
            "class Helper extends Base { override accessor method = () => {}; }",
            Some(json!([{ "ignoreOverrideMethods": true }])),
        ),
        (
            "class Helper extends Base { override get method() { return 1; } }",
            Some(json!([{ "ignoreOverrideMethods": true }])),
        ),
        (
            "class Helper implements Contract { method() {} }",
            Some(json!([{ "ignoreClassesWithImplements": "all" }])),
        ),
        (
            "class Helper implements Contract { private method() {} }",
            Some(json!([{ "ignoreClassesWithImplements": "all" }])),
        ),
        (
            "class Helper implements Contract { #method() {} }",
            Some(json!([{ "ignoreClassesWithImplements": "all" }])),
        ),
        (
            "class Helper implements Contract { public method() {} }",
            Some(json!([{ "ignoreClassesWithImplements": "public-fields" }])),
        ),
        (
            "class Helper implements Contract { method = () => {}; }",
            Some(json!([{ "ignoreClassesWithImplements": "public-fields" }])),
        ),
        (
            "class Helper implements Contract { accessor method = () => {}; }",
            Some(json!([{ "ignoreClassesWithImplements": "public-fields" }])),
        ),
        (
            "class Helper implements Contract { get method() { return 1; } }",
            Some(json!([{ "ignoreClassesWithImplements": "public-fields" }])),
        ),
    ];
    let fail = vec![
        ("class Helper { method() {} }", None),
        ("class Helper { method() {} }", Some(json!([{}]))),
        ("class Helper { method() { return function() { return this.value; }; } }", None),
        ("class Helper { get method() { return 1; } }", None),
        ("class Helper { set method(value: number) {} }", None),
        ("class Helper { method = () => {}; }", None),
        ("class Helper { method = function() {}; }", None),
        ("class Helper { accessor method = () => {}; }", None),
        ("class Helper { accessor method = function() {}; }", None),
        ("class Helper { method() {} }", Some(json!([{ "exceptMethods": ["#method"] }]))),
        ("class Helper { #method() {} }", Some(json!([{ "exceptMethods": ["method"] }]))),
        ("class Helper { method() {} }", Some(json!([{ "enforceForClassFields": false }]))),
        ("class Helper { method = () => {}; }", Some(json!([{ "enforceForClassFields": true }]))),
        (
            "class Helper { accessor method = () => {}; }",
            Some(json!([{ "enforceForClassFields": true }])),
        ),
        ("class Helper extends Base { override method() {} }", None),
        (
            "class Helper extends Base { override method() {} }",
            Some(json!([{ "ignoreOverrideMethods": false }])),
        ),
        ("class Helper { method() {} }", Some(json!([{ "ignoreOverrideMethods": true }]))),
        ("class Helper implements Contract { method() {} }", None),
        ("class Helper { method() {} }", Some(json!([{ "ignoreClassesWithImplements": "all" }]))),
        (
            "class Helper implements Contract { private method() {} }",
            Some(json!([{ "ignoreClassesWithImplements": "public-fields" }])),
        ),
        (
            "class Helper implements Contract { protected method() {} }",
            Some(json!([{ "ignoreClassesWithImplements": "public-fields" }])),
        ),
        (
            "class Helper implements Contract { #method() {} }",
            Some(json!([{ "ignoreClassesWithImplements": "public-fields" }])),
        ),
        (
            "class Helper implements Contract { private method = () => {}; }",
            Some(json!([{ "ignoreClassesWithImplements": "public-fields" }])),
        ),
        (
            "class Helper implements Contract { private accessor method = () => {}; }",
            Some(json!([{ "ignoreClassesWithImplements": "public-fields" }])),
        ),
    ];

    // Run identical cases through both rules rather than reimplementing the upstream oracle.
    Tester::new(
        EslintClassMethodsUseThis::NAME,
        EslintClassMethodsUseThis::PLUGIN,
        pass.clone(),
        fail.clone(),
    )
    .change_rule_path_extension("ts")
    .test();
    Tester::new(ClassMethodsUseThis::NAME, ClassMethodsUseThis::PLUGIN, pass, fail)
        .change_rule_path_extension("ts")
        .test();
}

#[test]
fn test_options_apply_without_http_exception() {
    use crate::tester::Tester;
    use serde_json::json;

    let pass = vec![
        (
            "import { Get } from '@nestjs/common'; class Controller { @Get() handler = () => {}; }",
            Some(json!([{ "enforceForClassFields": false }])),
        ),
        (
            "import { Get } from '@nestjs/common'; class Controller { @Get() accessor handler = () => {}; }",
            Some(json!([{ "enforceForClassFields": false }])),
        ),
        (
            "import { Get } from '@nestjs/common'; class Controller { @Get() get handler() { return 1; } }",
            Some(json!([{ "exceptMethods": ["handler"] }])),
        ),
        (
            "import { Get } from '@nestjs/common'; class Controller extends Base { @Get() override get handler() { return 1; } }",
            Some(json!([{ "ignoreOverrideMethods": true }])),
        ),
        (
            "import { Get } from '@nestjs/common'; class Controller implements Contract { @Get() handler = () => {}; }",
            Some(json!([{ "ignoreClassesWithImplements": "public-fields" }])),
        ),
    ];
    let fail = vec![
        (
            "import { Get } from '@nestjs/common'; class Controller { @Get() get handler() { return 1; } }",
            Some(json!([{ "enforceForClassFields": false }])),
        ),
        (
            "import { Get } from '@nestjs/common'; class Controller { @Get() set handler(value: number) {} }",
            Some(json!([{ "enforceForClassFields": false }])),
        ),
        (
            "import { Get } from '@nestjs/common'; class Controller implements Contract { @Get() private handler = () => {}; }",
            Some(json!([{ "ignoreClassesWithImplements": "public-fields" }])),
        ),
    ];
    Tester::new(ClassMethodsUseThis::NAME, ClassMethodsUseThis::PLUGIN, pass, fail)
        .change_rule_path_extension("ts")
        .test();
}

#[test]
fn test_static_http_handlers_require_companion_rule() {
    use crate::{rules::nestjs::no_static_handlers::NoStaticHandlers, tester::Tester};

    let cases = vec![
        "import { Get } from '@nestjs/common'; class Controller { @Get() static handler() {} }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() static get handler() { return 1; } }",
        "import { Get } from '@nestjs/common'; class Controller { @Get() static set handler(value: number) {} }",
    ];
    Tester::new(ClassMethodsUseThis::NAME, ClassMethodsUseThis::PLUGIN, cases.clone(), vec![])
        .change_rule_path_extension("ts")
        .test();
    Tester::new(NoStaticHandlers::NAME, NoStaticHandlers::PLUGIN, vec![], cases)
        .change_rule_path_extension("ts")
        .test();
}
