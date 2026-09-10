use oxc_ast::{AstKind, ast::Expression};

use crate::LintContext;

/// Resolves a called HTTP decorator factory to a value import from `@nestjs/common`.
///
/// Supports named aliases and namespace members with a statically known name. It does not
/// follow assignments, re-exports, custom decorator composition, or dynamic property names.
pub fn is_nestjs_http_handler_decorator(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    let (identifier, is_namespace_member) = match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => (identifier.as_ref(), false),
        callee => {
            let Some(member) = callee.as_member_expression() else {
                return false;
            };
            if !member.static_property_name().is_some_and(is_http_decorator_name) {
                return false;
            }
            let Some(identifier) = member.object().get_identifier_reference() else {
                return false;
            };
            (identifier, true)
        }
    };

    let Some(symbol_id) = ctx.scoping().get_reference(identifier.reference_id()).symbol_id() else {
        return false;
    };
    if !ctx.scoping().symbol_flags(symbol_id).is_import() {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::ImportDeclaration(import) = ctx.nodes().parent_kind(declaration.id()) else {
        return false;
    };
    if import.import_kind.is_type() || import.source.value != "@nestjs/common" {
        return false;
    }

    match declaration.kind() {
        AstKind::ImportSpecifier(specifier) => {
            !is_namespace_member
                && !specifier.import_kind.is_type()
                && is_http_decorator_name(specifier.imported.name().as_str())
        }
        AstKind::ImportNamespaceSpecifier(_) => is_namespace_member,
        _ => false,
    }
}

fn is_http_decorator_name(name: &str) -> bool {
    matches!(
        name,
        "RequestMapping"
            | "Get"
            | "Post"
            | "Delete"
            | "Put"
            | "Patch"
            | "Options"
            | "Head"
            | "All"
            | "Search"
            | "QueryMethod"
            | "Propfind"
            | "Proppatch"
            | "Mkcol"
            | "Copy"
            | "Move"
            | "Lock"
            | "Unlock"
            | "Sse"
    )
}
