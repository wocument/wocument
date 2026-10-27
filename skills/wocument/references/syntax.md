# Syntax

The grammar (`wocument-grammar.md`) is normative; this is what you need to write files.

## A file

```
---
wocument: 1
title: The Keepers of the Light
lang: en-GB
theme: ./edition.woct
description: One sentence for search and social cards.
---

%% design head: definitions only (\font \token \palette \breakpoint \grid \style \spot \parent \folio)
\style[name=body, size=20px]

%% stories (optional), then scenes (optional)
\story[name=main]{ ... }
\scene[...]{ ... }
```

- **Frontmatter** is YAML, metadata only: `wocument` (always `1`) and `title` are required;
  `lang`, `theme`, `description`, `author` (string or list), `date` (ISO), `section`,
  `social-image` are optional. Any other field is an error. Quote a value that contains `: `
  or starts with a quote mark: `title: "Night: a story"`.
- **Order**: frontmatter, design head, stories, scenes. Definitions must come before the first
  `\story` or `\scene`.
- **Implicit form**: a file with no `\scene` is one magazine page: everything after the design
  head is the article. Mixing top-level content with explicit scenes is an error.
- A `.woct` theme holds definitions only: no frontmatter, no stories, no scenes. A document loads
  at most one, through `theme:`.

## Commands

Every construct has one shape: `\name[key=value, key@breakpoint=value]{body}`.

- Names are lowercase letters; the set is closed (`commands.md`).
- No space between the name and `[`, or between `]` and `{`.
- Bodiless commands end at the first character that is not a lowercase letter or `[`:
  `Stone \br and Strategy`.
- A block command ends the paragraph before it. Only `\br`, `\span` and `\endmark` are inline.
- A command's body accepts only the children its schema lists (`commands.md`, "children").

## Attributes

```
[cols=1-8, cols@tablet=all, columns=2, columns@phone=1, alt="A keeper at the lamp", loop]
```

- Comma-separated; a trailing comma is fine; newlines are fine.
- A bare boolean means true: `[loop]` is `[loop=true]`.
- `key@phone=` overrides one breakpoint (`phone`, `tablet`, `compact`, `wide` by default).
  Attributes marked "not responsive" in `commands.md` take no suffix.
- Strings with spaces or commas are double-quoted. Duplicate keys are an error.

## Values

| Type | Examples |
| :---- | :---- |
| integer, number | `3`, `1.5`, `-0.02` |
| length | `24px` `1.5rem` `0.02em` `50%` `40vw` `100vh` `2col` `3bl` |
| fluid | `fluid(18px, 22px)`: from 360px to the default grid's `max`, clamped; `fluid(min, max, from, to)` |
| range (grid tracks) | `1-4`, `5-end`, `3`, `all` |
| ratio | `3:2`, `16:9`, `auto` |
| time | `600ms`, `0.4s` |
| color | `#1a1a1a`, `#fff`, `#00000080` (hex only) |
| role | `paper` `ink` `muted` `accent` `rule` |
| token | `$brand-red` |
| pair | `"50% 30%"` (quoted) |
| polygon | `poly(0 0, 1 0, 0.5 1)` (box coordinates 0 to 1) |

Units: `col` is one column of the scene's grid (`2col` includes one gutter); `bl` is one
baseline step of the grid; `vh` is the small viewport height; `%` is of the box the attribute
names.

## Text

- Blank lines separate paragraphs; a single newline is a space; indentation never matters.
- `**bold**`, `*italic*` (italic inside an italic style sets upright), `` `code` ``,
  `[link text](https://...)`, `\span[style=name]{...}` for a character style, `\br` for a
  forced line break in display text.
- `--` en dash, `---` em dash, `...` ellipsis. Straight quotes are curled for `lang`.
- `[sic]` needs no escaping; a `%` is literal; `%%` starts a comment to the end of the line.
- Escapes: `\\` `\{` `\}` `\[` `\]` `\*` `` \` `` `\%` `\-` `\.` `\"`.
- No HTML, no lists, no tables, no footnotes (deferred in this version).

## Formatting

`woc format --write file.woc` rewrites a file in canonical form (attribute order, spacing,
indentation). Run it before delivering.
