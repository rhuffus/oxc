# Coding agent guides for `crates/oxc_formatter_markdown`

Follow @../oxc_formatter_core/FORMATTER_POLICY.md , this file holds only the Markdown-specific rules.
Known divergences live in DIVERGENCES.md.

## Overview

Prettier compatible Markdown formatter on `oxc_formatter_core`.
Entry points and their contracts are documented in `src/format.rs`.

Parses with [`oxc-markdown-parser`](https://github.com/oxc-project/oxc-markdown-parser).
Parse behavior targets micromark (what Prettier parses with); its AGENTS.md / DIVERGENCES.md are the reference.
Style facts (markers, fence kind, setext, break kind, list padding, ...) are AST fields and `ParserReturn::blanks` lists the blank lines,
so the printer never re-derives layout from the source text.
Formatter policy (sentence splitting, CJK, aligned lists, escaping) stays here.

### Envelope

Source is normalized to `\n` before parsing (verbatim slices go straight into the IR), the configured line ending is re-emitted at print time,
a leading BOM is preserved.

Front matter is not handled yet (`oxc_formatter_core::spec::parse_front_matter` + `envelope::write_front_matter`, as CSS does).

## Verification

```sh
cargo run -p oxc_formatter_markdown --example markdown_formatter [filename]
DUMP_IR=1 cargo run -p oxc_formatter_markdown --example markdown_formatter [filename]

# The oracle. Without `--no-config --no-editorconfig` the repo's `.editorconfig` changes the output
node apps/oxfmt/node_modules/prettier/bin/prettier.cjs --parser markdown --no-config --no-editorconfig [filename]
# Prettier's doc, when the output alone does not explain a layout
node -e 'const p=require("./apps/oxfmt/node_modules/prettier");p.__debug.printToDoc(require("fs").readFileSync(process.argv[1],"utf8"),{parser:"markdown"}).then(d=>p.__debug.formatDoc(d)).then(console.log)' [filename]
```

### Prettier conformance

At the current version (v3.9.6), these divergences have been confirmed and are intentional (see DIVERGENCES.md):

Conformance failures classified as divergences: `thematicBreak/simple.md` (`#leading-thematic-break`), `link/encodedLink.md` (`#url-escaping`).

### Fixture fingerprint

`tests/fixtures/fingerprint.rs` serializes the AST's meaning (structure, decoded text, destinations, labels) and ignores what formatting may change (spans, markers, fence style, text splitting, whitespace runs, tightness).
The harness asserts it is identical for input and output: every fixture is a `parse(format(x)) ≅ parse(x)` check, which idempotency alone cannot give (a corrupted output is often a fixpoint).
Extend the ignore set only with a reason written next to it.
