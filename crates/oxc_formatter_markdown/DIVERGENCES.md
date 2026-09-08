# Known divergences

Admission reasons and rules: see `crates/oxc_formatter_core/FORMATTER_POLICY.md` "Known divergences".

## leading-thematic-break

- Why: semantics (prettier/prettier#19839)
- Pin: `tests/fixtures/markdown/thematic-break-first.md`

```markdown
<!-- input -->
---

text

---

<!-- ours -->
***

text

---

<!-- prettier -->
---

text

---
```

A document whose first block is a thematic break gets `***`, never `---`:
Prettier's own next run would read `---` ... `---` as front matter and swallow `text` into it.
Prettier `main` prints `***` since #19839; the pin (3.9.6) still prints `---`.

## url-escaping

- Why: semantics (prettier/prettier#19482, prettier/prettier#19849, prettier/prettier#19891)
- Pin: `tests/fixtures/markdown/link-url-special-chars.md`

```markdown
<!-- input -->
[a](https://x/()foo->bar)

<!-- ours -->
[a](<https://x/()foo-\>bar>)

<!-- prettier -->
[a](<https://x/()foo-%3Ebar>)
```

Destinations follow Prettier `main`: `<`, `>` inside the angle brackets are backslash-escaped (the pin percent-encodes them, which changes the URL),
a `\` that would start an escape is doubled, and `&` that would start a character reference becomes `\&`
(the pin drops the escape and the reference is decoded on the next parse).
Titles get the same `\&` treatment.

## indented-code-tab

- Why: uniform-rule (same construct, same output: space-indented code block)
- Pin: `tests/fixtures/markdown/indented-code-tab.md`

````markdown
<!-- input: two spaces, a tab -->
  	foo

<!-- ours -->
    foo

<!-- prettier -->
```
foo
```
````

An indented code block is printed indented, however its 4 columns were written.
Prettier recognizes indented code from the raw text with a regex (four spaces or a tab),
so an indent written as spaces plus a tab becomes a fenced block.

## ignored-block-trailing-quote-line

- Why: uniform-rule (same construct, same output: the `proseWrap: preserve` layout)
- Pin: `tests/fixtures/markdown/prose-wrap/ignored-block-trailing-quote-line.md`

```markdown
<!-- input -->
> <!-- prettier-ignore -->
> - a   long   item
> 

> next

<!-- ours -->
> <!-- prettier-ignore -->
> - a   long   item

> next

<!-- prettier, proseWrap: always -->
> <!-- prettier-ignore -->
> - a   long   item
>

> next
```

A blockquote's trailing blank `>` line is dropped, whatever `proseWrap` is.
Prettier drops it under `preserve` and `never` but prints a bare `>` under `always` when the block before it is `prettier-ignore`d.

## list-indented-code-alignment

- Why: semantics (prettier/prettier#19644, prettier/prettier#19647)
- Pin: `tests/fixtures/markdown/tab-width-4/list-indented-code.md`

```markdown
<!-- input, tabWidth 4 -->
- foo

      code

<!-- ours -->
- foo

      code

<!-- prettier -->
- foo

        code
```

An indented code block inside a list item is printed at the item's content column + 4, nothing more:
the code's content is exactly what follows that column, so any extra alignment becomes part of it on the next parse.
The pin aligns it by the task checkbox (continuation lines drift by 4 per run, #19644);
`main` (#19647) aligns it by the tab width instead, which shifts the content whenever `tabWidth` exceeds the marker width.

## list-marker-after-ignored-list

- Why: semantics
- Pin: `tests/fixtures/markdown/oxfmt-ignore.md`

```markdown
<!-- input -->
<!-- prettier-ignore -->
*   kept   as   written

- formatted

<!-- ours -->
<!-- prettier-ignore -->
*   kept   as   written

- formatted

<!-- prettier -->
<!-- prettier-ignore -->
*   kept   as   written

* formatted
```

Adjacent lists alternate markers so they stay two lists. A list kept verbatim by `prettier-ignore` shows its own marker, so the list after it takes the other one;
Prettier alternates from the marker it would have printed (`-`), prints `*` next to the verbatim `*` list, and the two merge into one list on the next parse.
