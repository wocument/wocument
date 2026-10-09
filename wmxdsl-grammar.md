---
title: WMXDSL Formal Grammar
version: 0.2 (Draft)
status: Working Draft
date: 2026-09-19
companion-to: wmxdsl-specification.md
---

# WMXDSL Formal Grammar

For the parser team. This document defines exactly which character sequences are valid WMXDSL and what tree they produce. The specification says what things mean; this says how they parse. Where the two disagree on syntax, this document wins (the differences are listed in §12).

---

## 01 Architecture

Parsing is three phases. Only the third knows command names.

| Phase | Input | Output | Knows the schema? |
| :---- | :---- | :---- | :---- |
| **A0 Prepare** | bytes | normalized text, frontmatter split off | No |
| **A Surface parse** | text | surface tree: commands, attribute lists, bodies, raw text, blank-line marks, comments | No |
| **B Shape** | surface tree + command schema | AST: typed attributes, paragraphs, inline runs, validated children | Yes |
| **C Document checks** | AST | AST + document-level diagnostics | Yes |

The reason for the split: phase A is a small, fixed, context-free grammar that never changes when commands are added. Syntax highlighters and formatters only need phase A. Adding a command is a schema table edit, not a grammar change.

Notation: W3C-style EBNF. `::=` defines, `|` alternates, `?` `*` `+` repeat, `[...]` is a character class, `[^...]` negates, `A - B` means A but not B, `"..."` is a literal, `/* */` is a comment. Character classes are over Unicode code points.

---

## 02 Phase A0: prepare

1. Decode as UTF-8. Invalid sequence: `L001`.
2. Strip one leading U+FEFF if present.
3. Replace `\r\n` and lone `\r` with `\n`. All positions refer to this normalized text.
4. **Document files (`.wmx`)**: the first line MUST be a fence. Collect lines up to the next fence, hand them to a YAML 1.2 parser. Everything after the closing fence's newline is the content.
5. **Theme files (`.wmxt`)**: no frontmatter. The whole text is the content. A leading fence is `P045`.

```
fence      ::= "---" hspace* NL
hspace     ::= [ #x9]
NL         ::= #xA
```

Missing opening fence: `P001`. No closing fence before EOF: `L005`. YAML errors are reported as `P001` with the YAML parser's position mapped back into the file. Field validation (required fields, unknown fields): `P002`, `P003`.

**Positions**: `line` and `column` are 1-based. `column` and `length` count Unicode code points, not bytes or UTF-16 units. Tools that speak LSP convert at the boundary.

---

## 03 Phase A: surface grammar

### 03.1 Grammar

```
content       ::= item*
item          ::= line-comment | trail-comment | blank | command | escape | text

command       ::= "\" name attrs? body?
name          ::= [a-z]+                            /* maximal munch */
attrs         ::= "[" attr-list "]"                 /* "[" immediately after name, no whitespace */
body          ::= "{" content "}"                   /* "{" immediately after name or after attrs "]" */

escape        ::= "\" escchar
escchar       ::= [\\{}\[\]()%*`\-."']

line-comment  ::= SOL hspace* "%%" [^#xA]* NL       /* whole line, NL included */
trail-comment ::= hspace* "%%" [^#xA]*              /* NL not included */

blank         ::= NL (hspace* NL)+                  /* one or more empty lines */

text          ::= textchar+
textchar      ::= [^\\{}%]
                | "%" (?! "%")                      /* a single % is text */
```

`SOL` is start of line. `(?! x)` is negative lookahead.

### 03.2 Rules the grammar cannot express

1. **Item priority** at each position: `line-comment`, `trail-comment`, `blank`, `command`, `escape`, `text`. First match wins.
2. **`\` dispatch**: after `\`, if the next character is `[a-z]` it is a `command`; if it is in `escchar` it is an `escape`; anything else is `L004`.
3. **Adjacency**: `[` starts `attrs` only if it is the character directly after `name`. `{` starts `body` only if it is the character directly after `name` or directly after the `]` closing `attrs`. There is no whitespace skipping. `\frame [x]` is a bodiless, attribute-less command followed by the text ` [x]`.
4. **Bare braces are never text.** A `{` that is not a body opener is `P010`. A `}` that closes nothing is `P011`. A reported stray `{` absorbs one later unmatched `}` at the same depth, so one mistake produces one diagnostic: `\headline {Hi}` gives `P010` (plus `P018`), not `P010` and `P011`. When a `{` follows a command after whitespace, the diagnostic adds the hint "remove the whitespace before `{`".
5. **Brackets and parentheses are text** everywhere except rule 3. They matter again in phase B (links).
6. **Comments**: a `line-comment` is removed together with its newline, so it never creates a paragraph break and never joins or splits anything. A `trail-comment` is removed with the horizontal whitespace before it; the newline stays. `%%` is not recognized inside `attrs` (it is an error there, see §04) and cannot appear inside a string.
7. **Comments and blanks are kept as trivia.** They are attached to the following node so a formatter can preserve them. Trivia with no following node in its body is attached to the enclosing command with placement `end-of-body` (to the document root, id `0`, at top level). `attachTo` MUST always name a node that exists. Phase B ignores comments.
8. Phase A does no whitespace normalization and does not interpret `*`, `` ` ``, `[`, `-` or `.` in text.

### 03.3 Escapes

An escape produces one literal character that phase B treats as opaque: it is never a delimiter, never part of a dash or dot run, never a bracket for link matching.

| Escape | Needed when |
| :---- | :---- |
| `\\` `\{` `\}` | Always, to get the literal character |
| `\%` | To write a literal `%%` (`\%%` or `\%\%`) |
| `\[` | Directly after a command name, or to stop a link from being recognized |
| `\]` `\(` `\)` | Inside link text or link URLs |
| `\*` `` \` `` | To write a literal asterisk or backtick that would otherwise delimit |
| `\-` `\.` | To break a dash or ellipsis run: `\-\-` is two hyphens |
| `\"` `\'` | To keep a straight quote that the resolver must not curl (feet, inches, code) |

Escaping a character that did not need it is valid. The formatter emits the minimal form.

---

## 04 Attribute lists

Inside `[...]` the lexer is in attribute mode. Newlines are whitespace here.

```
attr-list  ::= aws ( attr ( aws "," aws attr )* ( aws "," )? )? aws
attr       ::= key ( "@" ident )? ( aws "=" aws value )?
key        ::= [a-z]+ ( "-" [a-z]+ )*
ident      ::= [a-z] [a-z0-9]* ( "-" [a-z0-9]+ )*

value      ::= string | func | bare
string     ::= '"' ( strchar | '\"' | '\\' )* '"'
strchar    ::= [^"\\#xA]
func       ::= fname "(" aws ( arg ( aws "," aws arg )* )? aws ")"
fname      ::= [a-z]+
arg        ::= atom ( hspace+ atom )*
atom       ::= barechar+
bare       ::= barechar+
barechar   ::= [A-Za-z0-9_./:#$%+~\-]

aws        ::= ( hspace | NL )*
```

Rules:

1. `func` vs `bare`: a `bare` made only of `[a-z]` and directly followed by `(` is a `fname`.
2. An `attr` with no `=value` is boolean `true`. `[loop]` equals `[loop=true]`.
3. Empty list `[]` is valid and equals no list.
4. The same `key` with the same `@ident` twice: `P014`.
5. Newline inside a `string`: `L006`. EOF inside a string: `L002`. A backslash inside a string followed by anything other than `"` or `\`: `L003` with the hint "only `\"` and `\\` are escapes inside a quoted value". EOF or `{` `}` `\` inside `attrs`: `L003`.
6. Any character that fits none of the productions (including `%%`, `?`, `&`, `=` inside a value): `L003` with the hint "quote the value". URLs with query strings therefore need quotes.
7. `@ident` is only checked for being a well-formed identifier here. Whether the breakpoint exists is a resolve-stage check, because breakpoints may come from the theme file.

### 04.1 Typed values (phase B)

Phase A keeps `bare` values as raw strings. Phase B types each one using the attribute's declared type from the schema.

| Type | Accepts | Pattern (anchored) |
| :---- | :---- | :---- |
| `integer` | bare | `-?[0-9]+` |
| `number` | bare | `-?[0-9]+(\.[0-9]+)?` |
| `length` | bare | `number` + `px\|rem\|em\|%\|vw\|vh\|col\|bl`, or a bare `0` |
| `percentage` | bare | `number` + `%` |
| `time` | bare | `[0-9]+(\.[0-9]+)?(ms\|s)` |
| `range` | bare | `all` \| `N` \| `N-M` \| `N-end`, with `N`, `M` = `[1-9][0-9]*` and `N <= M` |
| `ratio` | bare | `auto` \| `[1-9][0-9]*:[1-9][0-9]*` |
| `color` | bare | `#` + 3, 4, 6 or 8 hex digits |
| `role` | bare | `paper\|ink\|muted\|accent\|rule` |
| `boolean` | bare or absent | `true\|false` |
| `enum(...)` | bare | one of the listed identifiers |
| `ident` | bare | `ident` production. Used for `name`, `at`, and references to grids, styles, palettes, stories, parents. |
| `string` | string, or bare | any |
| `path` | string, or bare | non-empty |
| `pair(T)` | string | two values of type `T` separated by spaces, for example `"50% 30%"`. The only user in v1 is `focus`, which is `pair(percentage)`. |
| `fluid` | func | `fluid(length, length)` or `fluid(length, length, length, length)`; `%`, `col`, `bl` units not allowed inside |
| `poly` | func | `poly(number number, ...)`, at least 3 points, every number in `0..1` |
| `tokenref` | bare | `\$` + `ident` |

Rules:

1. **Unions.** An attribute may declare several types, for example `height: length | enum(auto)` or `color: role | color`. Try in this order: `tokenref`, enum keywords, `role`, function types, then the remaining scalar types in schema order. The patterns are disjoint in practice, so order only matters for diagnostics.
2. **Token references** are accepted wherever the declared type includes `integer`, `number`, `length`, `percentage`, `time`, `color`, `ratio` or `string`, and as an `atom` inside a function. They are not accepted for `ident`, `enum`, `boolean`, `range`, `path` or `role`. The parser records the reference; the resolver substitutes and type-checks.
3. `\token[value=...]` has type `any`: the raw value is stored untyped and typed at each point of use.
4. A bare `0` length is stored with unit `px`; its `raw` spelling stays `0`. All units agree at zero.
5. A value that matches none of the declared types: `P015`, naming the expected types. A missing required attribute: `P016`.
6. Cross-field rules in the schema (`story=` forbids a body, `id` required when `provider=youtube`, and so on) are phase B checks.

---

## 05 Phase B: shaping

Phase B walks the surface tree top-down. For each command it looks up the schema row (§06) and applies the row's **body arity** and **body kind**.

### 05.1 Body arity

| Arity | Surface body absent | Surface body present |
| :---- | :---- | :---- |
| `none` | ok | `P017` |
| `optional` | ok, `body = null` | ok |
| `required` | `P018` | ok |

### 05.2 Body kinds

**`struct`**: only commands, comments and whitespace. Any other text: `P021`. Blank marks are ignored.

**`inline`**: the items form one inline sequence (§05.4). A blank mark inside: `P022`. A block-class command inside: `P023`. After trimming, an empty sequence: `P019`.

**`block`**: the items are split into a list of block nodes:

1. A `blank` mark ends the paragraph in progress.
2. A **block-class command** ends the paragraph in progress and becomes a node of its own. Text after it starts a new paragraph, with or without a blank line. Exception: if the paragraph in progress contains an odd number of unescaped backticks, a code span is open, so the command stays in the paragraph and the inline parser reports it as `P033`. The count resets at every paragraph boundary.
3. An **inline-class command** joins the paragraph in progress (or starts one).
4. Text and escapes join the paragraph in progress (or start one). Whitespace-only text between two block nodes produces no paragraph.
5. Each finished paragraph is parsed as an inline sequence.

Inline-class commands are exactly `\br`, `\span`, `\endmark`. Every other command is block-class.

Rule 2 is why these work without blank lines:

```
\dropcap[lines=3]
Stone endures where nearly everything else decays.
```

```
\pullquote{The wall was never the defence. \cite{H. Müller}}
```

**`scene`**: parsed as `block`, then classified:

| Children contain | Form | Extra rule |
| :---- | :---- | :---- |
| `\frame` or `\group` | `explicit` | Paragraphs, text elements, `\dropcap`, `\framebreak`: `P042` (`\music` is allowed in either form) |
| No frame or group, but a paragraph, text element, `\dropcap` or `\framebreak` | `shorthand` | None |
| Only objects and `\rule` | `explicit` | None |

A parent's `\folio` is chrome, not content: it is ignored when classifying, so it never makes a body `shorthand` and never triggers `P042`.

The parser records the form on the node. It does **not** synthesize the default frame; the resolver does. The AST always mirrors the source, which keeps formatting lossless.

### 05.3 Child validation

Each schema row lists the commands allowed in its body. A command not in the list: `P020`, naming the parent and listing what is allowed. Unknown command names are `P012` with a nearest-match suggestion (edit distance 2 or less) and unknown attribute keys are `P013`, same suggestion rule.

### 05.4 Inline grammar

Input: a sequence of text characters, escaped literals (opaque) and inline command nodes (opaque).

```
inline-seq ::= inline*
inline     ::= bold | italic | code | link | command-node | literal | dash | ellipsis | chars

bold       ::= "**" inline-seq "**"          /* no bold inside bold */
italic     ::= "*"  inline-seq "*"           /* no italic inside italic */
code       ::= "`" codeitem+ "`"
codeitem   ::= literal | [^`]
link       ::= "[" inline-seq "](" url ")"   /* no link inside link */
url        ::= ( urlchar | literal )+
urlchar    ::= [^ #x9#xA()]

dash       ::= "---" | "--"
ellipsis   ::= "..."
```

Deterministic recognition rules:

1. **Asterisk runs.** A maximal run of unescaped `*` has length 1, 2 or 3. Length 4 or more: `P034`.
   - A run is **closing-capable** if the character before it is not whitespace and not the start of the sequence.
   - A run is **opening-capable** if the character after it is not whitespace and not the end of the sequence.
   - A run that is neither is literal text (`2 * 3`).
   - Length 1 toggles italic, length 2 toggles bold. For each, if that span is open and the run is closing-capable, it closes; otherwise, if opening-capable, it opens; otherwise literal.
   - Length 3 is a bold delimiter plus an italic delimiter. If both are open it closes both, innermost first. If neither is open it opens bold then italic (bold outside). If exactly one is open it closes that one, then opens the other.
   - A close that does not match the innermost open span: `P031`.
   - A span still open at the end of the sequence: `P030`. Spans never cross a paragraph or a command body.
2. **Code spans.** An unescaped backtick opens a code span that ends at the next unescaped backtick in the same sequence. None found: `P032`. An empty code span (two adjacent backticks) is `P036`. Inside a code span asterisks, brackets, dashes and dots are literal. A command node inside a code span: `P033` with the hint "escape the backslash". Code spans are **not raw**: phase A has already processed escapes and comments, so a literal backslash in code is `\\` and a literal brace is `\{`.
3. **Links.** At an unescaped `[` outside code, scan forward in the same sequence for the matching unescaped `]`, counting nested unescaped brackets and treating command nodes and code spans as opaque. It is a link if and only if that `]` is directly followed by `(`, then one or more `urlchar` or escaped literals, then `)`. Otherwise the `[` is literal text and scanning resumes after it. So `He said [the mayor] was wrong` needs no escapes. A link whose text contains another link: `P035`.
4. **Dashes and dots.** Outside code spans and URLs, a maximal run of unescaped `-` of length exactly 2 becomes an en dash and exactly 3 becomes an em dash. A maximal run of unescaped `.` of length exactly 3 becomes an ellipsis. Any other length is literal.
5. **Whitespace.** After recognition, every run of spaces, tabs and newlines in text collapses to one space. Leading and trailing whitespace of the sequence is removed. Whitespace around `\br` is removed.
6. **Quotes** are left as straight quotes in the AST. Curling them per `lang` is the resolver's job. Escaped quotes are marked so the resolver leaves them alone.

---

## 06 Command schema

This table is normative for phase B. Attribute names, types and defaults per command are in the specification sections listed; this table adds what the grammar needs.

Child sets used below:

- **TEXT-EL** = `kicker headline deck byline meta lede subhead bio blockquote credit`
- **MARKER** = `dropcap framebreak rule music`
- **OBJECT** = `figure video embed lottie audio gallery pullquote sidebar`
- **STORY-CONTENT** = paragraphs + TEXT-EL + MARKER + OBJECT

| Command | Arity | Kind | Allowed children | Spec |
| :---- | :---- | :---- | :---- | :---- |
| `font` `token` `palette` `breakpoint` `grid` `style` | none | | | §07 |
| `parent` | optional | scene | as `scene` | §08.4 |
| `folio` | required | inline | | §10.5 |
| `story` | required | block | STORY-CONTENT | §09.1 |
| `scene` | required | scene | `frame group rule` + OBJECT, or STORY-CONTENT in shorthand form | §08.1 |
| `frame` | optional | block | STORY-CONTENT | §09.2 |
| `group` | required | struct | `frame rule` + OBJECT | §11.11 |
| `kicker` `headline` `deck` `byline` `meta` `lede` `subhead` `bio` | required | inline | | §10.3 |
| `caption` `credit` `title` `cite` | required | inline | | §10.3 |
| `blockquote` | required | block | paragraphs, `cite` | §10.3 |
| `pullquote` | required | block | paragraphs, `cite` | §11.10 |
| `sidebar` | required | block | paragraphs, `title figure` | §11.10 |
| `figure` `video` `embed` `lottie` `audio` | optional | struct | `caption credit` | §11.4 to §11.8 |
| `gallery` | required | struct | `figure video caption credit` | §11.9 |
| `dropcap` `framebreak` `rule` `music` | none | | | §10.4, §09.3, §10.6 |
| `br` `endmark` | none | | | §10.2, §10.4 |
| `span` | required | inline | | §10.2 |

Notes:

- Every `inline` body also accepts the inline-class commands `br` and `span`. `endmark` is accepted only in a paragraph directly inside STORY-CONTENT; elsewhere `P020`.
- `cite` and `title` may appear at most once per parent: `P020` on the second.
- `parent` also accepts one `folio` child, its own running label (spec §10.5): `P020` on a second. `scene` does not accept `folio`.
- `frame` with a `story` attribute and a body: `P044`.
- `framebreak` takes one boolean attribute, `column`.
- `span` requires `style` (`P016` without it).

### 06.1 Schema row format

Implement the schema as data, one row per command. Suggested shape:

```ts
type CommandSchema = {
  name: string
  class: "inline" | "block"
  arity: "none" | "optional" | "required"
  kind: "struct" | "inline" | "block" | "scene" | null
  children: string[]                    // command names; "#paragraph" allows paragraphs
  maxOnce: string[]                     // children limited to one occurrence
  attrs: Record<string, {
    types: TypeName[]                   // §04.1, tried in the order given there
    enum?: string[]
    required?: boolean
    default?: string                    // canonical source spelling of the default
    responsive?: boolean                // false for name, at, story, src-independent keys; default true
  }>
  rules: ((cmd: Command) => Diagnostic | null)[]   // cross-field checks
}
```

Attributes with `responsive: false` reject an `@breakpoint` suffix (`P013`, hint "this attribute cannot vary by breakpoint"). `at` exists on `\grid`, `\style` and `\parent` only. Non-responsive attributes are: `name`, `at`, `extends`, `story`, `parent`, `provider`, and every attribute of `\font`, `\token`, `\breakpoint`.

---

## 07 Phase C: document checks

The root content is shaped as a `block` body, then:

```
document   ::= definition* doc-item*                    /* explicit form  */
             | definition* ( story-content | folio )*   /* implicit form  */
doc-item   ::= story | scene | folio
definition ::= font | token | palette | breakpoint | grid | style | parent
theme      ::= definition*
```

1. **Form.** If the root contains at least one `\scene`, the document is explicit. Otherwise it is implicit.
2. **Explicit form**: a root paragraph, TEXT-EL, MARKER or OBJECT is `P041`. `\frame` or `\group` at the root is `P020`.
3. **Implicit form**: `\story`, `\frame`, `\group` at the root are `P020` (hint: "add a `\scene`"). Everything that is not a definition or `\folio` becomes `implicitContent`.
4. A definition after the first non-definition node: `P040`.
5. More than one `\folio` at document level: `P043`. A `\parent` may hold one more of its own (§06 notes).
6. Theme files: any non-definition node, or any paragraph: `P045`.

Name resolution (does grid `feature` exist, does story `main` have frames, do breakpoints overlap) is **not** the parser's job. That is the resolve stage.

---

## 08 AST

Extends §15.2 of the specification. Differences are marked.

```ts
type Document = {
  version: 1
  frontmatter: Frontmatter
  definitions: Command[]
  folio: Command | null                 // added
  form: "explicit" | "implicit"         // added
  stories: Command[]                    // explicit form
  scenes: Command[]                     // explicit form
  implicitContent: Node[]               // implicit form, added
  trivia: Trivia[]                      // added
}

type Node = Command | Paragraph

type NodeId = number                    // unique per parse, assigned in document order; the document root is 0

type Command = {
  kind: "command"
  id: NodeId                            // added
  name: CommandName
  attrs: Attr[]
  body: Node[] | Inline[] | null        // by schema kind
  sceneForm?: "explicit" | "shorthand"  // scene and parent only, added
  source: Pos
}

type Attr = { key: string; at: string | null; value: Value; source: Pos }

// Every Value variant also carries `raw: string`, the author's exact spelling,
// so the formatter can write values back unchanged (§09 rule 7).
type Value =
  | { t: "integer" | "number"; n: number }
  | { t: "length"; n: number; unit: Unit }
  | { t: "percentage"; n: number }
  | { t: "time"; ms: number }
  | { t: "range"; from: number; to: number | "end" }      // all = {from: 1, to: "end"}
  | { t: "ratio"; w: number; h: number } | { t: "ratio"; auto: true }
  | { t: "color"; hex: string }                            // normalized to 8 lowercase hex digits
  | { t: "role" | "enum" | "ident"; id: string }
  | { t: "boolean"; b: boolean }
  | { t: "string" | "path"; s: string }
  | { t: "pair"; a: Value; b: Value }
  | { t: "fluid"; min: Value; max: Value; from?: Value; to?: Value }
  | { t: "poly"; points: [number, number][] }
  | { t: "tokenref"; name: string }
  | { t: "any"; raw: string }                              // \token value only

type Paragraph = { kind: "paragraph"; id: NodeId; runs: Inline[]; source: Pos }

type Inline =
  | { type: "text"; value: string; escapedQuotes?: number[] }
  | { type: "bold" | "italic"; runs: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; runs: Inline[] }
  | { type: "command"; node: Command }  // replaces the "span" and "br" variants; covers \br \span \endmark

type Trivia = { type: "comment" | "blank"; text: string; attachTo: NodeId; placement: "before" | "trailing" | "end-of-body"; source: Pos }
type Pos    = { line: number; column: number; length: number }
```

En dash, em dash and ellipsis are stored as their Unicode characters in `text.value`. The formatter writes them back as `--`, `---`, `...`.

---

## 09 Canonical form

`format(parse(src))` MUST be a fixed point: formatting it again changes nothing. `parse(format(ast))` MUST equal `ast` apart from positions.

1. Encoding UTF-8, no BOM, `\n` newlines, one trailing newline.
2. Frontmatter fields in the order of spec §04.
3. Attribute order: schema order. For each key: base value first, then `@` overrides in breakpoint declaration order. Attributes equal to their default are **kept** (the formatter never deletes author intent).
4. `, ` between attributes. No trailing comma. No spaces around `=`.
5. `true` booleans are written bare (`loop`), `false` is written `key=false`.
6. `string` and `pair` values are always quoted. `path` values are quoted only when they contain a character outside `barechar`. Everything else is bare.
7. Colors are written as the author wrote them, lowercased.
8. An attribute list longer than 100 columns breaks after commas, continuation lines aligned one column past the `[`.
9. Body indentation is two spaces per nesting level. `struct` and `block` bodies put `{` at the end of the opening line and `}` on its own line. `inline` bodies stay on one line.
10. Between block nodes, one blank line where the source had one or more, and none where it had none, so the author's grouping survives. Two paragraphs always have one (without it they would be one paragraph). Exception: no blank line between `\dropcap` and the paragraph it applies to.
11. Each paragraph is written on a single line. The formatter does not hard-wrap prose.
12. Escapes are minimal: only characters that would otherwise be misread are escaped.
13. Whole-line comments keep their position relative to the following node. Trailing comments stay on their line, preceded by two spaces.

---

## 10 Error recovery (tolerant mode)

Builds stop at the first phase that produces an error, after reporting every error found in that phase. Editors need more, so the parser also has a tolerant mode that always returns a tree:

1. **Unbalanced `{`** (`P010`): close the body at the next blank line whose following line starts, after whitespace, with `\` at a brace depth equal to the opener's depth, or at EOF. Mark the node `recovered`.
2. **Unknown command** (`P012`): keep the node with `name` as written and `unknown: true`; parse its body as `block`; do not validate children.
3. **Unknown or invalid attribute** (`P013`, `P015`): drop that attribute, keep the rest.
4. **Attribute list errors** (`L003`): skip to the first `]` that is followed by `{`, a newline or EOF.
5. **Inline errors** (`P030` to `P036`): treat the offending delimiter as literal text and continue.

A recovered tree MUST NOT be handed to the resolve stage in a production build.

---

## 11 Diagnostics

Codes are stable. Messages may be reworded. `P012` and the `W` codes match the examples in the specification.

| Code | Meaning |
| :---- | :---- |
| `L001` | Invalid UTF-8 |
| `L002` | Unterminated string |
| `L003` | Malformed attribute list |
| `L004` | Invalid escape: `\` followed by a character that is neither `[a-z]` nor escapable |
| `L005` | Unterminated frontmatter |
| `L006` | Newline inside a string |
| `P001` | Frontmatter missing or not valid YAML |
| `P002` | Unknown frontmatter field |
| `P003` | Required frontmatter field missing or wrong type |
| `P010` | `{` that does not open a body, or body never closed |
| `P011` | `}` that closes nothing |
| `P012` | Unknown command |
| `P013` | Unknown attribute, or `@` suffix on a non-responsive attribute |
| `P014` | Duplicate attribute |
| `P015` | Value does not match the attribute's type |
| `P016` | Required attribute missing |
| `P017` | Body given to a command that takes none |
| `P018` | Body missing on a command that requires one |
| `P019` | Empty inline body |
| `P020` | Command not allowed here |
| `P021` | Text not allowed here (struct body) |
| `P022` | Paragraph break inside an inline body |
| `P023` | Block command inside an inline body |
| `P030` | Emphasis not closed |
| `P031` | Emphasis closed in the wrong order |
| `P032` | Code span not closed |
| `P033` | Command inside a code span |
| `P034` | Run of four or more asterisks |
| `P035` | Link inside a link |
| `P036` | Empty code span |
| `P040` | Definition after the first story, scene or content |
| `P041` | Top-level content in a document that has scenes |
| `P042` | Text content in a scene that has frames or groups |
| `P043` | More than one document-level `\folio` |
| `P044` | `\frame` with both `story=` and a body |
| `P045` | Theme file contains frontmatter, content or non-definition commands |

---

## 12 Differences from specification 0.2

Decisions this grammar had to make. The specification has been updated to match.

1. **Escape set widened**: `\(` `\)` `\-` `\.` `\"` `\'` added. Literal double hyphen is `\-\-` (the spec's `\--` would give a hyphen plus an en dash under the run rule).
2. **`\pullquote` body is block kind** (paragraphs plus `\cite`), same as `\blockquote`. Multi-paragraph pull quotes are valid.
3. **Block commands end paragraphs** without needing a blank line (§05.2 rule 2).
4. **Code spans are not raw.** Escapes and comments apply inside them.
5. **No whitespace** between a command name and `[`, or between `]` and `{`.
6. **Brackets in prose are literal** unless they form a complete `[text](url)` link.
7. **Unmatched emphasis and code delimiters are errors**, except an asterisk run with whitespace on both sides, which is literal.
8. **URLs with `?`, `&`, `=`, `,` or spaces must be quoted** in attribute values.
9. **Strings cannot contain newlines.**
10. **The parser does not desugar.** Shorthand scenes and the implicit scene are recorded as forms on the AST; the resolver expands them.
11. **Comments and blank lines are kept as trivia** so the formatter is lossless. Spec §03.4 said the lexer drops them; consumers other than the formatter still never see them.

---

## 13 Conformance tests

Minimum vectors. `→` is the expected result. `¶` is a paragraph node.

| # | Input (content only) | Expected |
| :---- | :---- | :---- |
| 1 | `40% of readers, 100%.` | One `¶`, text unchanged. |
| 2 | `Done. %% note` | `¶` "Done." plus trailing-comment trivia. |
| 3 | `A\n%% c\nB` | One `¶` "A B". |
| 4 | `A\n\n%% c\n\nB` | Two `¶`. |
| 5 | `\%% literal` | `¶` "%% literal". |
| 6 | `\frame [x]` inside a scene | `\frame` with no attrs, no body, then text ` [x]` → `P042`. |
| 7 | `\headline {Hi}` | `P018` and `P010` with the whitespace hint. |
| 8 | `\dropcap[lines=3]\nStone endures.` | `dropcap` node, then one `¶`. |
| 9 | `Text \figure[src=/a.png, alt=""] more.` | `¶` "Text", `figure`, `¶` "more." |
| 10 | `\pullquote{Short. \cite{A. Name}}` | `pullquote` with `¶` "Short." and `cite`. |
| 11 | `\headline{A\n\nB}` | `P022`. |
| 12 | `He said [the mayor] was wrong.` | One text run, brackets literal. |
| 13 | `See [the *full* report](https://x.org/a).` | Link with text, italic, text. |
| 14 | `[a](b c)` | Not a link (space in URL): literal text. |
| 15 | `2 * 3 * 4` | Literal asterisks. |
| 16 | `***both***` | bold(italic("both")). |
| 17 | `**a *b** c*` | `P031`. |
| 18 | `a -- b --- c ---- d \-\- e ... f ....` | en dash, em dash, four literal hyphens, two literal hyphens, ellipsis, four literal dots. |
| 19 | `` `\\frame` `` | Code span with value `\frame`. |
| 20 | `` `\frame` `` | `P033`. |
| 21 | `\frame[cols=1-8, cols@phone=all, hide@tablet]` | Three attrs: range 1..8, range 1..end at phone, boolean true at tablet. |
| 22 | `\frame[cols=1-8, cols=2-4]` | `P014`. |
| 23 | `\frame[cols=8-1]` | `P015`. |
| 24 | `\style[name=x, size=fluid(18px, 22px), tracking=-0.02em]` | fluid with two lengths; length -0.02em. |
| 25 | `\figure[src=https://x.org/i.png?w=2, alt=""]` | `L003` with the quoting hint. |
| 26 | `\figure[src="https://x.org/i.png?w=2", alt=""]` | Valid. `alt` is an empty string. |
| 27 | `\figure[src=/a.png, shape=poly(0 0, 1 0, 0.5 1), alt="x"]` | poly with three points. |
| 28 | `\palette[name=n, accent=$ember]` | tokenref accepted for a color type. |
| 29 | `\scene[grid=$g]{}` | `P015`: tokenref not accepted for `ident`. |
| 30 | `\scene[name@phone=x]{}` | `P013` with the non-responsive hint. |
| 31 | `\pullqoute{x}` | `P012`, suggestion `pullquote`. |
| 32 | Scene containing `\frame[story=main]` and a bare paragraph | `P042`. |
| 33 | Document with a `\scene` and a root-level paragraph | `P041`. |
| 34 | Document with no `\scene`, a `\headline` and prose | Implicit form, two nodes in `implicitContent`. |
| 35 | `\grid[...]` after a `\story` | `P040`. |
| 36 | `\frame[story=main]{text}` | `P044`. |
| 38 | `A\n%% c\n\nB` | Two `¶`. The comment line vanishes with its newline, leaving a blank line. |
| 39 | ` `` ` (two adjacent backticks) in a paragraph | `P036`. |
| 40 | `\span{x}` | `P016`: `style` is required. |
| 41 | `\figure[src=/a.png, alt="", focus="40px 20px"]` | `P015`: `focus` is a pair of percentages. |
| 42 | `\story[name=s]{Text %% c\n}` and a body ending in a whole-line comment | Trailing trivia attaches to the story's id with placement `end-of-body`; no `attachTo` points at a missing node. |
| 43 | `\parent[name=p]{\frame{x} \folio{A}}` | No diagnostics; the parent stays `explicit`. A second `\folio` in the parent is `P020`; `\folio` in a `\scene` is `P020`. |
| 37 | Any valid file | `format(format(x)) == format(x)` and `parse(format(parse(x)))` equals `parse(x)` ignoring positions. |
