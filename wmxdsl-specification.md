---
title: WMXDSL Specification
version: 0.2 (Draft)
status: Working Draft
date: 2026-09-19
authors: Wocument
supersedes: WMX 0.1
---

# WMXDSL

A domain-specific language for screen-native editorial layout.

---

## 01 What WMXDSL is

WMXDSL describes a magazine-quality editorial article for digital screens: its content, its grid, its typography, its frames, its media and its scroll behavior, all in one source file. A compiler turns that file into a responsive web page.

The design target is studio-level editorial layout, written as code. That means the language gives direct control over the things an editorial designer controls: grids, margins, gutters, baseline, type styles, text frames, text threading, runaround, image fitting, layering and reveals.

### 01.1 In scope

- Scroll-based articles built from **scenes**. No fixed page size.
- Author-defined **grids** with margins, gutters, rows and a baseline.
- **Text frames** on the grid, **linked frames** with automatic threading, overset handling, multi-column frames, column balancing.
- **Text wrap** around rectangles and around non-rectangular **contours**.
- Named **type styles**, fonts, color palettes and tokens.
- **Responsive** behavior through named breakpoints and fluid values.
- **Media**: high-res images, GIF, video, embeds, Lottie animation, audio, galleries.
- **Enter/exit reveals** on scenes and objects.
- Sensible **defaults** for everything. A file with zero design code still renders a good article.

### 01.2 Out of scope

- PDF or print export.
- Cover page design.
- CMS, workflow, AI pipelines, layout classification.
- Logic: variables beyond tokens, macros, conditionals, loops, code execution.
- Packages, plugins, user-defined commands. Reserved for a later version, not part of the MVP.

### 01.3 Deferred (planned, not MVP)

Pinned scenes, step triggers, scroll-scrubbed media, parallax, text on a path, tables, lists, footnotes, image zoom/lightbox, nested grids, math, cross-references, vertical and RTL-specific layout controls.

Found by the 0.2 stress test and also deferred: scrim or tint over media, a generic styled paragraph (`\p`) and `\question`, vertical bleed, side and positioned overlay captions, per-scene padding, `align` on frames, borders and quote marks on text boxes.

Implementers should not design these out. They should not build them either.

---

## 02 Core model

Read this section first. Everything else is detail.

| Concept | What it is |
| :---- | :---- |
| **Document** | One article. One source file. Compiles to one web page (one URL). |
| **Scene** | A full-width horizontal band of the article. Scenes stack vertically in source order. Each scene picks its own grid, palette and height mode. A scene change is the screen equivalent of a page turn. |
| **Grid** | A named definition: column count, gutter, margins, max width, baseline step, optional rows. Every placement in a scene addresses this grid. |
| **Story** | A named run of text content (paragraphs, subheads, anchored objects). A story has no position of its own. |
| **Frame** | A rectangle on a scene's grid that displays text. A frame shows either its own inline content or a slice of a named story. |
| **Thread** | The ordered list of all frames that reference the same story. Text flows through them in document order, across scenes. |
| **Object** | A placed non-text item: figure, video, embed, Lottie, audio, gallery, pull quote, sidebar, group. Objects can exclude text (wrap). |
| **Style** | A named set of typographic properties. Every text element has a default style of the same name. |
| **Breakpoint** | A named viewport width range. Grids, styles and individual attributes can be overridden per breakpoint. |
| **Reveal** | An enter or exit animation on a scene or object. Reveals never change layout. |

### 02.1 The cascade

Every property resolves through this chain. Later wins.

1. Built-in default theme (§16)
2. Theme file (§07.8)
3. Document-level definitions
4. Parent scene (§08.4)
5. Scene
6. Element
7. Breakpoint override of any of the above (§06.4)

No property is ever undefined. If the author sets nothing, the built-in default applies.

**Where breakpoint redefinitions sit.** A breakpoint redefinition (`at=` on `\grid`, `\style`, `\parent`) applies within its own level, straight after that level's base definition: theme base, then theme `at=`, then document base, then document `at=`. So a document's `\style[name=body, size=20px]` beats the theme's phone size, and a document that wants a different phone size says so with its own `at=phone`. An `at=` redefinition takes every property it does not set from the same name's base definition. Attribute-level overrides (`key@phone=`, rule 7) still win over everything.

### 02.2 Document shape

A source file has four parts, in this order:

1. **Frontmatter**: metadata only.
2. **Design head**: definitions (`\font`, `\token`, `\palette`, `\breakpoint`, `\grid`, `\style`, `\parent`). Optional.
3. **Stories**: `\story` blocks. Optional.
4. **Scenes**: `\scene` blocks.

Definitions MUST appear before the first `\story` or `\scene`.

**Implicit scene.** If a document contains no `\scene`, everything after the design head is set as one magazine page: a `height=page` scene on the default grid. The heading elements it begins with (any run of `\kicker`, `\headline`, `\deck`, `\lede`, `\byline`, `\meta`) go in a heading frame, `cols=1-8, cols@tablet=all, cols@phone=all`; the rest goes in a story frame, `cols=all, columns=auto, columns@wide=4, columns@tablet=1, measure=600px`, set in column bands (§09.7): as few columns as keep each within 600px (two below about 1480px, three above), four on wide screens (2026-10-07; until then 3, 4, 2 and 1 by breakpoint), one on a tablet and a phone (2026-10-09: a 600px line of about 63 characters; until then two on a tablet). A document that begins with no heading element gets the story frame alone. The scene and frames are `scene-1`, `frame-1` and `frame-2` (or `frame-1` alone), each frame holding its own text. This is the zero-config path. (Until 2026-10-07: one flow scene with one frame on the grid's `body` columns; changed 2026-10-07.) Mixing top-level content with explicit scenes is a parse error.

---

## 03 Lexical structure

### 03.1 Encoding and lines

Files are UTF-8. A BOM is stripped if present. `\r\n` and `\r` are normalized to `\n` before lexing. All source positions refer to normalized lines. File extension: `.wmx` for documents, `.wmxt` for theme files.

### 03.2 Reserved characters

| Character | Meaning | Where |
| :---- | :---- | :---- |
| `\` | Command introducer, escape character | Everywhere |
| `{` `}` | Body delimiters | Everywhere |
| `[` `]` | Attribute delimiters | Directly after a command name |
| `=` `,` | Key/value and pair separators | Inside `[...]` |
| `@` | Breakpoint suffix on attribute keys | Inside `[...]` |
| `$` | Token reference | Inside attribute values |
| `%%` | Line comment | Outside `[...]` |
| `---` | Frontmatter fence | Top of file only |

Change from WMX 0.1: the comment marker is `%%`, not `%`. A single `%` is always literal, so prose like "40% of readers" and values like `width=50%` need no escaping.

### 03.3 Escapes

| Sequence | Result |
| :---- | :---- |
| `\\` | Literal backslash |
| `\{` `\}` | Literal braces |
| `\[` `\]` `\(` `\)` | Literal brackets and parentheses (only needed directly after a command name, or inside links) |
| `\%` | Literal `%` (only needed to write a literal `%%`) |
| `\*` `` \` `` | Literal inline-formatting characters |
| `\-` `\.` | A hyphen or dot that does not join a dash or ellipsis run. Two literal hyphens: `\-\-` |
| `\"` `\'` | A straight quote that must not be curled |

A backslash followed by anything else that is not a known command is an error. The exact rules are in the companion document `wmxdsl-grammar.md`, which is normative for syntax.

### 03.4 Comments

`%%` starts a comment that runs to end of line. Comments never reach the resolver; the parser keeps them as trivia only so the formatter can preserve them. A whole-line comment is removed with its newline, so it never breaks a paragraph. Comments are not allowed inside `[...]`.

### 03.5 Whitespace

- Blank lines separate paragraphs.
- A single newline inside a paragraph is a space.
- Indentation is never significant.
- Whitespace and newlines are allowed anywhere inside `[...]`, so long attribute lists can span lines.

---

## 04 Frontmatter

YAML 1.2 between `---` fences at the top of the file. Metadata only. No layout or design values live here.

| Field | Type | Required | Notes |
| :---- | :---- | :---- | :---- |
| `wmxdsl` | integer | Yes | Language major version. Currently `1`. |
| `title` | string | Yes | Used for `<title>` and social cards. Independent of `\headline`. |
| `lang` | BCP-47 tag | No | Default `en`. Drives hyphenation and the `lang` attribute. |
| `theme` | path | No | One theme file (§07.8). The only import mechanism in the language. |
| `description` | string | No | Meta description. |
| `author` | string or list | No | Metadata only. The visible byline is `\byline`. |
| `date` | ISO date | No | |
| `section` | string | No | |
| `social-image` | path | No | |

Unknown frontmatter fields are a parse error.

---

## 05 Commands

Every construct in the language is a command with one shape:

```
\name[key=value, key=value]{body}
```

| Part | Required | Notes |
| :---- | :---- | :---- |
| `\name` | Yes | Lowercase letters only. The set of names is closed (Appendix A). |
| `[...]` | No | Attribute list. |
| `{...}` | Per command | Each command's schema says whether it takes a body. Definition commands and some markers take none. |

Rules:

- Unknown command: parse error with a "did you mean" suggestion.
- Unknown attribute: parse error.
- A bodiless command ends at the first character that is not a lowercase letter or `[`. Example: `Stone \br and Strategy`.
- No whitespace between the name and `[`, or between `]` and `{`.
- A block-level command always ends the paragraph before it, with or without a blank line. Only `\br`, `\span` and `\endmark` are inline.
- A command's schema lists which child commands its body accepts. Anything else is a parse error.

### 05.1 Command families

| Family | Commands | Section |
| :---- | :---- | :---- |
| Definitions | `\font` `\token` `\palette` `\breakpoint` `\grid` `\style` `\parent` | §07 |
| Structure | `\scene` `\story` `\frame` `\group` | §08, §09 |
| Text elements | `\kicker` `\headline` `\deck` `\byline` `\meta` `\lede` `\subhead` `\blockquote` `\bio` `\caption` `\credit` `\title` `\cite` | §10 |
| Text markers | `\dropcap` `\framebreak` `\rule` `\music` `\endmark` `\br` `\span` | §10 |
| Objects | `\figure` `\video` `\embed` `\lottie` `\audio` `\gallery` `\pullquote` `\sidebar` | §11 |
| Chrome | `\folio` | §10.5 |

---

## 06 Attributes and values

### 06.1 Syntax

```
[key=value, other-key="value with spaces", key@phone=value]
```

- Keys: lowercase letters and hyphens.
- Pairs are comma-separated. A trailing comma is allowed.
- Commas inside `(...)` or `"..."` do not split pairs.
- A boolean key may be written bare: `[loop]` equals `[loop=true]`.
- Duplicate keys (same key, same breakpoint) are a parse error.

### 06.2 Value types

| Type | Examples | Notes |
| :---- | :---- | :---- |
| Integer | `3`, `12` | |
| Number | `1.5`, `-0.02` | |
| Length | `24px`, `1.5rem`, `0.02em`, `50%`, `40vw`, `100vh`, `2col`, `3bl` | Units in §06.3 |
| Fluid length | `fluid(18px, 22px)` | §06.3 |
| Range | `1-4`, `5-end`, `3`, `all` | Grid tracks, inclusive, 1-indexed |
| Pair | `"50% 30%"` | Two space-separated values, quoted |
| Ratio | `3:2`, `16:9`, `auto` | |
| Time | `600ms`, `0.4s` | |
| Color | `#1a1a1a`, `#fff`, `#00000080` | Hex only. Named colors come from palettes and tokens. |
| Token ref | `$brand-red` | Resolves to the token's value, then type-checks |
| Enum | `cover`, `contour`, `screen` | Per attribute |
| Boolean | `true`, `false` | |
| String | `"A caption"` | Double-quoted, escapes as §03.3 |
| Path | `/img/keep.png`, `./hero.mp4`, `https://...` | Relative paths resolve from the source file |
| Function | `poly(0 0, 1 0, 1 1, 0 1)` | Only where an attribute's schema allows it |

### 06.3 Units

| Unit | Meaning |
| :---- | :---- |
| `px` | CSS pixel |
| `rem` `em` | Root and current font size |
| `%` | Percent of the reference box stated per attribute (frame width for `width`, object box for `focus`, and so on) |
| `vw` `vh` | Viewport width and height. `vh` resolves to the small viewport height on mobile so browser chrome never clips a screen scene. |
| `col` | Width of one grid column of the current scene's grid at the current breakpoint. `2col` includes the one gutter between the two columns. |
| `bl` | One baseline step of the current grid. `3bl` with `baseline=28px` is `84px`. |

`fluid(min, max)` scales linearly with viewport width from `min` at 360px to `max` at the `max` width of grid `default` at the active breakpoint (1440px unless redefined), and clamps outside that range. It is the `default` grid, not the scene's, so a paragraph keeps one size when its story threads into a scene with another grid. The four-argument form `fluid(min, max, from, to)` sets the viewport range explicitly.

### 06.4 Responsive values

Any attribute on any command can be overridden for one breakpoint by suffixing the key:

```
\frame[cols=1-8, cols@tablet=all, cols@phone=all, columns=2, columns@phone=1]
```

- The unsuffixed value is the **base** value. It applies whenever the active breakpoint has no override.
- Exactly zero or one breakpoint is active at any viewport width (§07.4), so overrides never stack.
- `hide=true` is available on every frame and object, and is normally used with a suffix: `hide@phone`.

`\grid`, `\style` and `\parent` also accept `at=<breakpoint>` to redefine the whole definition for one breakpoint (§07.5, §07.6, §08.4). No other definition takes `at`. To change palette per breakpoint use `palette@phone=night` on the scene.

### 06.5 Validation

Each command has a schema: attribute names, types, defaults, allowed children, cross-field constraints. Validation runs at parse time, per breakpoint where relevant. Every attribute has a default, and the spec states it.

---

## 07 Design definitions

All definition commands are bodiless except `\parent`. A definition with a `name` that already exists in a lower cascade level replaces it property by property, not wholesale.

### 07.1 `\font`

Registers a font file. The text engine needs real font metrics, so every family used by a style must be either registered here or be a generic family (`serif`, `sans-serif`, `monospace`).

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `family` | string | required | |
| `src` | path | required | `woff2` recommended |
| `weight` | integer or range | `400` | `300-700` for a variable font |
| `italic` | boolean | `false` | |

Layout MUST NOT run until every font used in the viewport's scenes has loaded. If a font fails to load, the engine falls back to the style's next family and emits an asset warning.

### 07.2 `\token`

A named constant. No arithmetic, no logic.

```
\token[name=brand-red, value=#e0563a]
\token[name=space-l, value=4bl]
```

Referenced as `$brand-red`. The reference is replaced by the value, then type-checked against the attribute. A cycle or an unknown token is a resolve error.

### 07.3 `\palette`

A named set of color roles. The role set is fixed.

| Role | Used for |
| :---- | :---- |
| `paper` | Scene background |
| `ink` | Primary text |
| `muted` | Captions, meta, credits |
| `accent` | Kickers, links, drop caps, pull quote marks |
| `rule` | Rules and borders |

```
\palette[name=night, paper=#0d0d0f, ink=#f2efe9, muted=#9a968e, accent=#e0563a, rule=#2a2a2e]
```

Styles refer to roles (`color=accent`), not hex values, so switching a scene's palette restyles everything inside it. The palette named `default` applies when a scene names none.

### 07.4 `\breakpoint`

| Attribute | Type | Notes |
| :---- | :---- | :---- |
| `name` | identifier | required |
| `min` | length (px) | optional |
| `max` | length (px) | optional |

Breakpoint ranges MUST NOT overlap (resolve error). Any viewport width not covered by a named breakpoint is the **base** range. Built-in: `phone` (max 639px), `tablet` (640px to 1023px), `compact` (1024px to 1419px: small laptops, added 2026-10-07; to 1419px from 1439px on 2026-10-09, so a 1440px screen showing a 15px scroll bar is still base), `wide` (1800px and up, added 2026-10-07). Base is therefore 1420px to 1799px. Redefining a built-in name replaces it.

### 07.5 `\grid`

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | identifier | `default` | |
| `at` | breakpoint | none | Redefines this grid for one breakpoint |
| `cols` | integer | `12` | Number of columns |
| `gutter` | length | `24px` | Space between columns |
| `margin-x` | length | `64px` | Left and right outer margin |
| `margin-y` | length | `4bl` | Top and bottom scene padding |
| `margin` | length | none | Shorthand for both |
| `max` | length | `1440px` | Max width of the column area. Beyond it the grid centers and margins grow. |
| `baseline` | length | `28px` | Baseline step. Defines the `bl` unit. Normally equals body leading. |
| `rows` | integer | `6` | Row count. Only used by screen-height scenes (§08.2). |
| `row-gap` | length | same as `gutter` | |
| `outdent` | length | `0` | How far an object whose box is on the grid's left or right outer edge (a figure, pull quote or sidebar in the first or last column), or a frame with its own text such as a heading block, reaches into the margin. A frame showing a threaded story (`story=`) never does. `%` is of the side margin: `50%` reaches halfway to the screen's edge. Text never does. Never past the viewport. Added 2026-09-28 for Vanilla. |
| `body` | range | `4-9` | Columns used by the default frame when a scene declares none. The default gives roughly 75 to 80 characters per line at the default body size; keep body text between 60 and 80. |

```
\grid[name=feature, cols=12, gutter=24px, margin-x=64px, max=1440px, baseline=28px, body=4-9]
\grid[name=feature, at=tablet, cols=8, gutter=20px, margin-x=40px, baseline=27px, body=2-7]
\grid[name=feature, at=phone,  cols=4, gutter=16px, margin-x=20px, baseline=26px, body=all]
```

**Geometry.** With viewport width `W`: content width `C = min(W - 2*margin-x, max)`, column width `= (C - (cols-1)*gutter) / cols`, grid origin x `= (W - C) / 2`. Column ranges resolve to pixel intervals from this. There are no guides or snapping in the language: every placement is already on a grid line or a baseline step.

**Linearize rule.** If a frame or object has a `cols` range that does not fit the active grid (for example `cols=9-12` on the 4-column phone grid) and no override for that breakpoint, the whole scene **linearizes** at that breakpoint: frames and objects stack in source order at `cols=all`, multi-column frames become one column, wrap becomes `jump`. The compiler emits a warning naming the scene and breakpoint. `linearize@phone=true` on a scene requests this explicitly and silences the warning.

- **Hidden elements do not count.** A frame or object hidden at that breakpoint is ignored by the test; its placement need not fit.
- **An anchored object linearizes alone.** The scene an anchored object (§11.3) lands in is known only during layout, so when its `cols` do not fit, the object itself becomes `side=full` with `wrap=jump` at that breakpoint, and no scene linearizes on its account. The warning names the object.
- **In a screen scene**, linearized frames and grid-placed objects take flow placement (`top` and `height` auto) in source order. Background objects are unchanged. The scene stays at least one viewport tall and grows past it under `overset=grow`.

### 07.6 `\style`

A named paragraph or character style.

| Attribute | Type | Default (for `body`) | Notes |
| :---- | :---- | :---- | :---- |
| `name` | identifier | required | |
| `extends` | style name | none | Inherit all properties from another style |
| `at` | breakpoint | none | |
| `family` | string | see §16 | CSS-style fallback list |
| `weight` | integer | `400` | |
| `italic` | boolean | `false` | |
| `size` | length or fluid | `19px` | |
| `leading` | length | `1bl` | Line height. Use `bl` to stay on the baseline grid. |
| `tracking` | length (em) | `0em` | Letter spacing |
| `case` | `none` `upper` `lower` `small-caps` | `none` | |
| `align` | `left` `right` `center` `justify` | `left` | `justify` spreads every line but a paragraph's last to the full width of its slot, by widening the line's spaces. With `composer=line` (the default) the line breaks are the ones the ragged setting would take, so a narrow column can open wide gaps; `composer=paragraph` evens them out. A line a little longer than its slot (the paragraph composer's) closes its spaces instead, by at most 0.05em each. A line that would open its spaces by more than half an em (a sliver beside a picture) is set flush left instead (2026-09-30). |
| `color` | palette role, color or token | `ink` | |
| `indent` | length | `0` | First-line indent. Always skipped for the first paragraph of a story, the first paragraph after any non-paragraph block (subhead, figure, pull quote, rule), and the paragraph a `\dropcap` applies to. |
| `space-before` | length | `0` | Suppressed at the top of a frame or column |
| `space-after` | length | `1bl` | |
| `hyphenate` | boolean | `true` | Uses document `lang` |
| `hyphenate-min` | integer | `5` | The shortest word, in letters, that hyphenates. Added 2026-10-07. |
| `hyphenate-caps` | boolean | `true` | `false`: a word that starts with a capital never hyphenates, so names, places and months stay whole (and a sentence's first word). Added 2026-10-07. |
| `composer` | `line` `paragraph` | `line` | How lines break. `line`: each line takes as many words as fit. `paragraph`: each break is chosen for the whole paragraph: of the line that fills the slot, up to three that break earlier and, justified, one that takes a little more and closes its spaces, the one with the least cost for itself and the rest of the paragraph at the column's width. Cost grows with the cube of how far spaces open (towards half an em) or close (towards 0.05em), or, ragged, of how short the line falls; a hyphen costs, a second in a row more, a third nearly forbids it; a last line of one word, or one that finishes a hyphenated word, costs as much as a very loose line. Balanced text keeps its own breaks. Added 2026-10-07. |
| `justify-min` | length | none | With `align=justify`, a line narrower than this (a strip beside a picture, a narrow column) is set ragged right. Unset: every line justifies. Added 2026-10-07. |
| `hang` | `none` `quotes` `punctuation` | `none` | Optical margins. `quotes`: an opening quotation mark that starts a line at the column's edge sits outside it, and a closing one that ends a justified line hangs past the other edge; `punctuation` also hangs a hyphen, full stop or comma ending a justified line. Never an exclamation or question mark. Lines with a first-line indent do not hang on the left. Added 2026-10-07; moved out of the deferred list (§01.3) on 2026-10-07. |
| `bind-short` | boolean | `false` | A short word (in English: a, an, the, of, to, in, on, at, by, for, and, or, but, nor, as, if, is, with, from, into, via, I) never ends a line: the space after it does not break. For display styles. Added 2026-10-07. |
| `widows` | integer | `2` | Min lines of a paragraph at the top of a frame or column |
| `orphans` | integer | `2` | Min lines of a paragraph at the bottom of a frame or column |
| `keep-with-next` | boolean | `false` | `true` by default for `subhead`. A kept block never ends a column: one that would, even one that ends exactly at the column's foot, moves on with the block after it (2026-09-30). |
| `mark` | string | none | A decorative mark, such as `"“"`, set above a pull quote's text at three times the style's size, bold, in the accent colour; layout makes room for it (0.45 of its size). A second character, as in `"“”"`, closes the quote after its last word, as large as the first, its top level with the last line's capitals; where it would not fit after the last word, the quote sets that much narrower. Added 2026-09-28; closing mark 2026-09-29, as large as the opening one 2026-09-30. |
| `min-slot` | length | 6em | The narrowest gap beside an object that text is set in (§09.6 step 3); a narrower gap stays empty and the text continues below. Unset, it is 6em of the style's final size. Added 2026-10-07. |
| `hyphen-mark` | `end` `both` | `end` | `both`: a word hyphenated at a line's end also shows a hyphen where it continues, hanging just left of the next line's first character, outside the column; layout is unchanged. Added 2026-09-29. |
| `balance` | boolean | `false` | Even lines: the paragraph breaks at the narrowest width that takes no more lines than its slot does, so no line is left with one word. For headlines, decks and pull quotes. Added 2026-09-28. |
| `features` | string | `"liga kern"` | OpenType feature tags, space-separated: `onum`, `smcp`, `lnum`, `tnum`, `ss01`... |
| `snap` | `baseline` `none` | `baseline` | See below |
| `fit` | `none` `width` | `none` | Fitted text: the largest size up to `fit-max` that splits no word and stays under `fit-height` |
| `fit-max` | length | 3 × `size` | |
| `fit-height` | length | none | |

**The `cite` style.** A pull quote's or blockquote's `\cite` is its container's style set upright. Where a theme or document defines a style named `cite`, its properties are laid over that (for example a smaller size and the muted colour); `em` in them is relative to the container's size. Added 2026-09-29.

**Default style binding.** Every text element uses the style with its own name: `\headline` uses style `headline`, prose paragraphs use `body`, `\caption` uses `caption`. Redefining `\style[name=headline, ...]` restyles every headline. To style one instance, define a new style and point at it:

```
\style[name=headline-xl, extends=headline, size=fluid(44px, 96px), tracking=-0.02em]
\headline[style=headline-xl]{Stone \br & Strategy}
```

`style=` is accepted by every text element and by `\span` for character-level styling.

**Baseline snapping.** With `snap=baseline`, each line's baseline sits on the grid's baseline step. With `snap=none` (the default for display styles: `headline`, `deck`, `pullquote`), lines use their own leading, and the block's total height is rounded up to a whole number of `bl` so the text after it is back on the grid; only when that text snaps (2026-09-30), so display lines in a row, a heading block's, keep their own spacing.

**`fit`**: `width` sets each paragraph in this style at the largest font size, from the style's `size` up to `fit-max` (default three times `size`), at which no word is split across lines and, if `fit-height` is set, the paragraph is no taller than it. Leading scales with the size. For a style that snaps to the baseline grid, the leading is rounded up to whole baseline steps. It is searched in whole pixels at layout, per width, like everything else layout does. Default `none`. Typical: the headline style, `\style[name=headline, fit=width, fit-max=120px, fit-height=25vh]`.

### 07.7 Units of reuse: what is and is not allowed

Allowed: tokens, palettes, styles, grids, parent scenes, one theme file. Not allowed: user-defined commands, parameters, includes of content, anything that computes.

### 07.8 Theme files

A `.wmxt` file contains only definition commands (no frontmatter, no stories, no scenes). A document loads at most one through frontmatter `theme:`. Document-level definitions override theme definitions by name. This is how a whole magazine shares one design.

---

## 08 Scenes

A scene is a full-width band. Scenes stack top to bottom in source order. One article is one page; the sense of "turning a page" comes from scene changes: a new grid, a new palette, a snap point, a reveal.

### 08.1 `\scene`

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | identifier | auto (`scene-1`...) | Becomes the element id, usable as a URL fragment |
| `grid` | grid name | `default` | |
| `parent` | parent name | none | §08.4 |
| `palette` | palette name | `default` | |
| `height` | `flow` `screen` `page` | `flow` | §08.2 |
| `snap` | `none` `soft` `hard` | `none` | §08.3 |
| `turn` | `none` `fade` `slide` | `none` | §08.3 |
| `bg` | color, role, token | `paper` | For image or video backgrounds use an object with `layer=background` (§11.2) |
| `linearize` | boolean | `false` | §07.5 |
| `enter` `exit` and reveal params | | | §13. Applied to the scene's children, staggered. |
| `folio` | `show` `hide` | `show` | §10.5 |

Body: frames, objects, groups. Bare text elements or prose directly inside a scene are shorthand for one default frame (`cols` = the grid's `body` range) holding that content.

### 08.2 Height modes

**`flow`**: the scene is as tall as its content plus `margin-y`. Vertical placement uses `top` and `height` lengths, or is automatic. Grid `rows` are ignored.

**`screen`**: the scene is exactly one viewport tall (small viewport height on mobile). The area inside `margin-y` is divided into the grid's `rows`, and frames and objects are placed with `rows=` ranges the same way they use `cols=`. If text oversets a screen scene and the story's overset policy is `grow`, the scene becomes taller than the viewport instead of losing text.

**`page`**: a page of a magazine. The scene is at least one viewport tall (small viewport height on mobile), and taller when its content needs it: its height is the greater of the viewport height and its content's bottom plus `margin-y`. Frames and objects place as in a flow scene: `cols=`, and `top` or automatic top. Grid `rows` are ignored. A multi-column frame with automatic height sets its text in **column bands** (§09.7).

### 08.3 Snap

**Scrolling** (2026-10-09). Nothing settles: the renderer eases the wheel (Lenis) everywhere, and the space bar and Page Down glide to the top of the next page, Shift + space and Page Up to the one before, over about a second, starting and landing softly, instead of the browser's own jump. A page is each screen of a page scene with column bands (its bands are screens, §09.7) and the top of every other scene; a document without them moves most of a screen at a time. Keys pressed in a control or a text field, or with a modifier, are the browser's. A vertical line of dots at the screen's right edge shows one dot per page, the current one larger; a dot glides to its page. The dots are decoration for assistive technology. Under reduced motion there is no easing and no glide: the browser's own scrolling. (From 2026-09-29 to 2026-10-09 page scenes settled on every screen, by proximity.)

For scenes that are not page scenes, `snap` maps to scroll snapping on the scene's top edge.

- `soft`: proximity snapping. Safe on any scene.
- `hard`: mandatory snapping. Valid on `height=screen` and `height=page` scenes. On a flow scene it is downgraded to `soft` with a warning, because mandatory snapping on a scene taller than the viewport traps the reader.
- On a `height=page` scene the default is `none` (2026-10-09; `soft` until then), and `hard` is kept: it stops the reader at the page's top without trapping them inside it.

**`turn`**: how the page arrives when the reader reaches it. `none` (default), `fade`, or `slide` (the content moves 8% of the viewport height into place while fading in, from below when scrolling down and from above when scrolling up). It plays each time the scene enters the viewport after being fully out of it, over the scene's `duration` (default `600ms`) with its `ease`. Like every reveal, it uses opacity and transform only and never affects layout (§13 rule 1). Under reduced motion it resolves to `none` (§13 rule 3). Without JavaScript the page is simply there (§13 rule 2).

### 08.4 `\parent` (master scenes)

A parent is a scene template. It takes the same attributes and body as `\scene`, plus `name` (required) and `at`.

```
\parent[name=chapter, grid=feature, palette=night, height=screen, snap=hard, enter=fade]{
  \rule[cols=1-2, rows=1]
}

\scene[parent=chapter]{ ... }
```

Rules:

- A scene inherits every attribute of its parent. The scene's own attributes override.
- The parent's children render beneath the scene's own children.
- Parent frames are inherited only if the scene declares no frames of its own.
- Parents do not chain (a parent cannot have a parent) in v1.

---

## 09 Stories, frames and threading

### 09.1 `\story`

A named run of content, declared at document level, outside any scene.

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | identifier | required | |
| `overset` | `grow` `clip` `error` | `grow` | §09.5 |
| `style` | style name | `body` | Default paragraph style for bare prose in this story |

Body: prose paragraphs, text elements, text markers, and anchored objects (§11.3).

### 09.2 `\frame`

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | identifier | auto | |
| `story` | story name | none | If set, the frame takes no body |
| `cols` | range | grid `body` | |
| `rows` | range | `all` | Screen scenes only |
| `top` | length | auto | Flow scenes only. Offset from the top of the scene's content area. Auto means below every earlier sibling in source order that overlaps its columns (the lowest of them), separated by the grid's `row-gap`; a sibling that wraps text (an object or frame with a `wrap`) is flowed around instead and does not count. With no such sibling, the top of the scene's content area. (Until 2026-09-29 only the previous such sibling counted, so a frame could start inside a taller one beside it.) The same rule applies to grid-placed objects. |
| `height` | length or `auto` | `auto` | Flow scenes only |
| `columns` | integer or `auto` | `1` | Internal columns. Equivalent to that many linked frames side by side. `auto` leaves the number to layout: the fewest columns that keep every column inside the target measure, so a wider screen gets more columns rather than longer lines. The target is `measure`; with no `measure` it is 32 times the size of the story's first paragraph, about 64 characters of a typical serif. A column is never wider than the target, so a target a little above the width you want avoids an extra column. Always at least one column. |
| `column-gap` | length | grid `gutter` | |
| `balance` | boolean | `true` | Balance internal columns when `height=auto` |
| `column-rule` | `none` `rule` | `none` | Draws a vertical line in the middle of the gap between each pair of adjacent columns, 1px in the palette's `rule` colour. In each band (or, for a frame that is not banded, across the frame) it runs from the band's top to the bottom of its tallest column. It is drawn only between two columns that both hold text in that band. |
| `wrap` | `none` `rect` | `none` | `rect`: the frame's box, from its top to the last thing it drew, cuts into the frames set after it in source order, as an object's rectangle does (§12.1). A heading frame over two of three columns, with the story frame at `top=0`, lets the third column start at the top beside it. Added 2026-09-28 for the Vanilla magazine layout. |
| `wrap-offset` | length | `1bl` | Space between the frame's last line and the text below it. Not at its sides: they are on grid lines, where the gutter already separates columns. |
| `valign` | `top` `center` `bottom` | `top` | Only with a definite height and content that fits |
| `measure` | length | `none` | Caps the width of every line in this frame, including lines set beside a wrap. The frame box is unaffected: the cap applies to the slot, and a capped slot stays left-aligned within it. Use it on any frame wider than the readable range. |
| `inset` | length | `0` | Inner padding |
| `bg` | color, role, token | none | |
| `z` | integer | source order | |
| `hide` | boolean | `false` | |
| `width` `min-width` `max-width` | length | none | Only inside a row group, which sizes its children with them (§11.11) |
| `enter` `exit` and reveal params | | | §13 |

Two forms:

```
\frame[cols=1-8, rows=4-6]{            %% inline form: the frame owns its content
  \kicker{Essay}
  \headline{Stone & Strategy}
}

\frame[story=main, cols=1-8, columns=2]  %% threaded form: the frame shows a slice of a story
```

An inline frame is an anonymous story with exactly one frame.

### 09.3 Threading

- The **thread** of a story is every frame with `story=<name>`, in document order (scene order, then source order inside the scene). Threads cross scene boundaries.
- Text fills frame 1, continues in frame 2 at the exact character where frame 1 ended, and so on. Internal columns of a frame fill left to right before the thread moves on.
- The thread order is per breakpoint after `hide` is applied. A story MUST have at least one visible frame at every breakpoint (resolve error otherwise). Story text is never dropped at a breakpoint; only its frames change.
- A story with no frames at all is a resolve error.

**How much text a frame takes:**

| Frame | Takes |
| :---- | :---- |
| Definite height (`height=<length>`, or any frame in a screen scene) | As many lines as fit, respecting widows, orphans and keep-with-next |
| `height=auto` | Everything up to the next `\framebreak` in the story, or to the end of the story |

`\framebreak` is a bodiless marker inside a story. It ends the current frame (all its remaining columns) and continues in the next frame of the thread. `\framebreak[column]` ends only the current internal column. The distinction matters: a plain `\framebreak` in column 1 of a two-column frame leaves column 2 empty, which is intended and must not be silently turned into a column break. A `\framebreak` with no next frame (or column) to move to is ignored with layout warning `W040`, and text continues where it is.

### 09.4 Column balancing

A frame with `columns>1`, `height=auto` and `balance=true` is set to the height that **minimizes the difference between its tallest and shortest column** (text that ends exactly at the last column's foot fits that height; 2026-10-07), with the smaller height as the tie-break. Level columns are the goal; a shorter frame is only a tie-break, because the two objectives disagree and a designer reads a two-line step as a defect.

The engine finds the height by search (lay out, measure, adjust). The search stops when the imbalance is within one baseline step, or when no trial improves on the best so far. Widows, orphans and wrap exclusions apply on every pass, and an anchored object's pin-and-reflow (§11.3) runs inside each trial, so a trial can cost up to four placements.

### 09.5 Overset

Overset is text left over after the last frame of a thread is full.

| Policy | Behavior |
| :---- | :---- |
| `grow` | The last frame becomes `height=auto`. A screen scene grows past the viewport if needed. No text is ever lost. |
| `clip` | Remaining text is not displayed. Compiler warning if detectable at build, runtime console warning otherwise. |
| `error` | Build fails if overset occurs at any test width (§15.4). |

Underset (frames left empty because the story ended) is not an error. Empty `auto` frames collapse to zero height; empty definite frames keep their size.

### 09.6 Line placement inside a frame

Normative description of what the layout stage does. For each frame (or internal column):

1. Start at the first baseline step inside the frame's top inset.
2. For the current line band (one leading tall), take the frame's horizontal interval and subtract every wrap exclusion that intersects the band (§12). The result is zero or more free **slots**.
3. Drop slots narrower than the minimum slot width (the style's `min-slot`, 6em by default). If that leaves no slot, the band is skipped and the line goes below: an object has a foot, so skipping ends under it. **Only in a column that is itself narrower than the minimum, keep the widest slot anyway** and emit layout warning `W042` (skipping could never end there, in a frame with no height limit, which an auto-height frame and the first pass of a balance search both are). The line is then set at that width, overflowing it if a single word does not fit. (Until 2026-09-30 every column kept its widest slot, which set text in slivers beside pictures on phones.)
4. Pick slots according to each excluding object's `wrap-side`.
5. For each chosen slot, left to right, ask the text engine for the next line at that slot's width, starting from the current cursor. Place the line. Advance the cursor.
6. Advance one leading. Repeat until the frame is full or the content for this frame ends.
7. Hand the cursor to the next frame in the thread.

Widows, orphans and `keep-with-next` are enforced at step 6 by ending the frame or column early and carrying lines forward.

### 09.7 Column bands

A frame in a `height=page` scene with `columns` of 2 or more and automatic height is set in **bands**. A band is one set of the frame's columns, filled column by column (§09.3).

Bands are **screen pages** (reading-flow design, 2026-09-29): each band is read top to bottom and left to right on one screen, and the space bar glides to the next (§08.3).

1. The first band starts at the frame's content top and ends at the bottom of the screen the frame's content top is on. If that leaves less than a quarter of a band (a screen less its margins; a third until 2026-09-30), it starts at the top of the next screen instead.
2. Text left over after a band starts a new band on the next screen, `margin-y` below its top. Every later band is one screen tall: the viewport height less twice `margin-y`. A page scene with column bands is a whole number of screens tall; one without (every frame a single column, as on a phone) is as tall as its content, at least one screen.
3. Bands continue until the story ends, or until a `\framebreak`, which sends the rest of the story to the next frame of its thread.
4. The last band is balanced (§09.4) within its band height, so an article does not end with one full column beside empty ones. No column of a balanced band holds a single line.
5. Widows, orphans and keep-with-next work within each band as they do within a frame; a block kept with the next one moves with it when orphan control moves it. Pin and reflow (§11.3) applies to one band at a time.
6. **Objects never interrupt a column.** An anchored object whose anchor falls below a column's top waits for the top of the next column, or the next band's first column. Several waiting objects open columns one each, in order; one that does not fit waits again. A pull quote or fact box with no text after it (before the story's end or a frame break) interrupts nothing, so it sets after the text where it fits; and once the text has ended, waiting pull quotes and fact boxes open columns before pictures, since a page of pictures alone is allowed and a page holding only a quote is not (2026-10-07). A frame break is an end of text like the story's end: objects still waiting there open the next column or band before the break sends the story on. No page holds objects alone (2026-09-30): when the text ends part-way down a band's last column with an object waiting, the object opens that column instead, the text below it, where the rest still fits; where it does not, the band sets a line less at a time until some text goes over with the object. In a band shorter than a full one (the first, under a heading) an object that does not fit waits for a full band rather than hang off the page. An anchored object taller than a full band is set at a band's top and overflows it (layout warning `W043`).
7. **Outlines wrap, gaps do not.** Where an object covers only part of a column, that column's text wraps its outline; a column it spans fully sets its text below its box (§12.1). No line is set in a gap narrower than 6em of its style.
8. **A little bleed.** A cut-out (`shape=alpha`) in a band is 150% of its column wide, reaching into the column read next, whose text wraps its outline; in the last column it stays one column wide. `max-width` caps it. No picture in the flow, cut-out or not, is taller than 85% of a full band (a screen less its margins): a taller one narrows, keeping its left edge (2026-09-30; a `cols=` picture is the author's to size).
9. **No hyphen at a turn.** The last line of a band's last column, and of any frame's last column whose story carries on, never ends in a hyphenated break: the line breaks earlier and the word carries on whole. Where a band's text ends before its last column (a later column holds only a picture), the page turns after the last column with text, and its last line is the one kept whole (2026-09-30).
10. **Where the text continues.** Where a band's last column, or any frame, ends with its story carrying on, the renderer draws a small arrow at the column's foot, against its right edge: under its last line, or under a picture that ends the column below a short line set beside it.
11. **Columns end together** (2026-09-30). Text is set on the grid's baseline, one body line a step, so lines in neighbouring columns share baselines. On a page scene the grid counts from each page's top, so every page's lines sit at the same heights (2026-10-07). In every band but the last, every column with text ends on the same line: where keep-with-next, orphans or widows would leave a column short, the band is set a line shorter at a time, up to six lines, and the setting whose columns end closest together wins (the first that ends them level; ties to the longer band). In a test of 171 pages of subheads and paragraphs of every length nine in ten end level and none more than a line apart (without the search, 66 level and 37 two lines apart or more); short of editing the copy, as a magazine would, that line is what remains.
12. **Pages end full** (2026-10-07). A page whose columns end short of its foot, level or not, has a photograph on it (a rectangular figure, not a cut-out, gallery or group member) take the difference: a line at a time taller, or up to three lines shorter, cropped by its `fit`, never under 60% of its own height or over 85% of a band. The first height that ends every column, text or picture, on the page's last line wins, the smallest change first. A page with no photograph, and a section's last page (rule 4), can still end short.
13. **No stub under a picture** (2026-10-07). A picture as wide as its column that leaves room for only one or two lines under it ends the column; the text goes on to the next column, and rule 12 may crop the picture down to the foot. A line that would end a page on a hyphen beside a narrow strip, where no shorter break exists, goes over to the next page whole.
14. **Figures take whole lines** (2026-10-08). A rectangular figure in a story, its caption included, is a whole number of baseline steps tall, so the text after it resumes exactly one standoff below and every column keeps the same rhythm. A photograph that crops (`fit=cover`) takes the nearest whole number of lines; one that must show whole is scaled down to the line above, centred in its space (letterboxed to the line below if that would shrink it by more than a sixth). Cut-outs keep their size: text wraps their outline line by line, already on the grid. A section's last page never holds three lines or fewer and nothing else: the page before is set again at full height to take them, where they fit.

A single-column frame in a page scene is not banded: it grows, as in a flow scene. So `columns@phone=1` gives phones a plain scrolling article.

`balance` has no effect on a banded frame: rule 4 always balances the last band, because an unbalanced last band leaves a gap a screen tall.

---

## 10 Text content

### 10.1 Prose

Text that is not inside a command body is prose. Paragraphs are separated by blank lines and use the story's default style (`body`). Raw HTML is never allowed.

### 10.2 Inline formatting

| Markup | Result |
| :---- | :---- |
| `**text**` | Bold |
| `*text*` | Italic |
| `` `text` `` | Code |
| `[text](url)` | Link |
| `\span[style=name]{text}` | Character style. `style` is required. |
| `\br` | Forced line break (display text: headlines, decks, pull quotes) |
| `--` / `---` / `...` | En dash, em dash, ellipsis. Runs of exactly that length only. For literals escape each character: `\-\-`. |

Bold sets weight 700, or 900 when the surrounding style is already 700 or heavier. Italic flips: inside an italic style it sets the text upright, as editorial typesetting does. Straight quotes are converted to typographic quotes according to `lang`. Links use the character style `link` and code spans use `code` (§16). Square brackets in prose are literal unless they form a complete link, so `[sic]` needs no escaping. Code spans are not raw: write `\\` for a backslash inside one. Underscore emphasis, strikethrough, reference links and auto-linking are not supported. One meaning, one syntax.

### 10.3 Anatomy of an editorial article, as elements

| Part of the page | Command | Body | Default style | Notes |
| :---- | :---- | :---- | :---- | :---- |
| Kicker (eyebrow, section label) | `\kicker` | inline text | `kicker` | |
| Headline | `\headline` | inline text | `headline` | Renders as `h1`. One per document expected (warning if more). |
| Deck (standfirst) | `\deck` | inline text | `deck` | |
| Byline | `\byline` | inline text | `byline` | |
| Meta (date, read time) | `\meta` | inline text | `meta` | |
| Lede (intro paragraph) | `\lede` | inline text | `lede` | Larger opening paragraph |
| Body text | bare prose | | `body` | |
| Drop cap | `\dropcap` | none | `dropcap` | Marker. Applies to the next paragraph. |
| Subhead (crosshead) | `\subhead` | inline text | `subhead` / `subhead-2` | `level=1` or `2`. Renders `h2`/`h3`. |
| Block quote | `\blockquote` | paragraphs, `\cite` | `blockquote` | Quoted material in the flow. Not a pull quote. |
| Pull quote | `\pullquote` | paragraphs, `\cite` | `pullquote` | An object (§11) |
| Sidebar (box) | `\sidebar` | `\title`, paragraphs, objects | `sidebar` | An object (§11) |
| Caption | `\caption` | inline text | `caption` | Child of media objects |
| Credit | `\credit` | inline text | `credit` | Child of media objects, or standalone for contributor credits |
| Rule | `\rule` | none | | Horizontal divider |
| End mark | `\endmark` | none | `endmark` | End-of-article sign, set after the last character of the last paragraph |
| Author bio | `\bio` | inline text | `bio` | |
| Folio | `\folio` | inline text | `folio` | Persistent label (§10.5) |

All text elements accept `style=` and, inside a multi-column frame, `span=all` (the only value in v1) to stretch across every column of the frame (typical for a subhead or a lede above columns).

### 10.4 Markers

**`\dropcap[lines=3, chars=1]`**: applies to the paragraph that follows. The engine takes the first `chars` graphemes (plus any opening quotation mark, as `quote` says: `inside` keeps it in the cap; `hang`, the default, keeps it in the cap but hangs it outside the column so the letter lines up with the text, or inside where the margin is narrower than the mark; `omit` leaves it out of the cap and the text; added 2026-10-07), sets them in the `dropcap` style scaled to span `lines` baseline steps, and excludes that box from the paragraph's first lines. The cap's height is `lines` baseline steps; its **width is the measured advance width of those glyphs at that size**, so it is measured during prepare (§15.4) and carried in the ResolvedDocument. It is never approximated from the height, which is visibly wrong for narrow letters. The author never splits the word in source.

**`\rule[weight=1px, color=rule, width=100%, align=left]`**: inside a frame it is a block; directly in a scene it is placed like an object and also accepts `name`, `cols`, `rows`, `top`, `offset-x`, `offset-y`, `z`, `hide`. It takes no `bleed`, `layer`, wrap or reveal attributes of its own, but it does take part in its scene's staggered reveal.

**`\endmark[glyph="■"]`**: an inline marker written at the end of the article's last paragraph.

### 10.5 `\folio`

A small label (publication name, section, article title): print's running head. It sits in the margin of every scene that shows it, centred in `margin-y` and aligned with the grid's outer edge, and scrolls with the page like the rest of the scene. A page scene (§09.7) shows it on every screen page, in the same place, so every page has the same head (2026-10-07). (Until 2026-09-28 it was fixed to the viewport, which let content scroll under it.) Declared once at document level, and optionally once inside a parent. A scene built from a parent that declares a folio shows the parent's; every other scene shows the document's.

| Attribute | Type | Default |
| :---- | :---- | :---- |
| `position` | `top-left` `top-right` `bottom-left` `bottom-right` `margin-left` `margin-right` | `top-left` |
| `progress` | boolean | `false` |

`margin-left` and `margin-right` set it in the top margin at the screen's own edge, a gutter in, rather than on the grid's edge: on a wide screen, the far corner (added 2026-09-28). `progress=true` adds a reading-progress indicator for the whole article, fixed to the viewport. A scene can suppress its folio with `folio=hide`. Each scene's folio takes its colors from that scene's palette; the progress indicator from the palette of the scene currently under it.


### 10.6 `\music`

A soundtrack cue (2026-10-09). Bodiless; allowed anywhere story content is, and straight inside a scene of either form.

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `src` | path or `none` | required | The track to play from here on. `none` fades the music out. |
| `fade` | time | `2s` | How long the crossfade to this track, or the fade-out, takes |
| `volume` | percentage | `80%` | |
| `loop` | boolean | `true` | `false` plays the track once |
| `enter-at` | percentage | `50%` | How far up the viewport, from its bottom, the cue's position must come before it fires |

**Where a cue sits.** In a story, at the first line of the block after it. Written straight in a scene with frames, at the scene's top.

**Which track plays.** Always the last cue above the reading position. Scrolling down past a cue plays its track, crossfading from the one before; scrolling back above it restores the one before. A cue with the same `src` as the track playing changes nothing. With no new cue, the music carries on across scenes.

**Starting the sound.** Browsers allow sound only after the reader's first tap, click or key press; scrolling does not count. Until then cues are armed silently and a quiet sound control is shown: a hairline circle with four small bars, fixed at the top of the screen's right edge on the line of the page dots and the scroll bar, in the page's muted colour, no words (its accessible name is "Sound"); the bars rest while off and move while on (still under reduced motion). The first tap, click or key press anywhere on the page starts the music at the cue in force. Readers who ask their device for reduced motion or reduced data get sound only from the button. Once a reader turns sound off, no gesture turns it back on. A hidden tab or a locked screen suspends the music; it resumes on return. Layout running again (a resize) never restarts it.

---

## 11 Objects and media

### 11.1 Common attributes

Every object accepts these.

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | identifier | auto | |
| `cols` | range | see §11.3 | |
| `rows` | range | `all` | Screen scenes |
| `top` | length | auto | Flow scenes, grid-placed objects |
| `height` | length or `auto` | `auto` | Auto derives from `ratio` or content |
| `bleed` | `none` `left` `right` `both` | `none` | Extends the box through the margin to the viewport edge |
| `max-width` | length | none | Caps the box width. The box keeps the centre of the space its placement gave it, so the room it gives back is shared by the text on both sides; `offset-x` moves it off centre. Use it to stop an object growing with the grid on a wide screen. A span narrower than the cap is unaffected. In a row group: the widest the child may grow (§11.11). |
| `min-width` | length | 1 column | Row groups only: the narrowest the child may be (§11.11) |
| `width` | length, `fit` | none | Anchored objects with `side=left`, `right` or `center` (§11.3). In a row group: a fixed width (§11.11); `fit`, for a text frame, the whole columns its widest line needs, set at the widest it could be beside the others (2026-09-30) |
| `offset-x` `offset-y` | length | `0` | Fine adjustment. `bl` recommended for `offset-y`. |
| `layer` | `background` `content` `overlay` | `content` | §11.2 |
| `z` | integer | source order | Within a layer |
| `wrap` and wrap params | | | §12 |
| `enter` `exit` and reveal params | | | §13 |
| `hide` | boolean | `false` | |

**Box and caption.** `cols`, `rows` and `height` size the whole object, caption and credit included. The media area is the box minus the caption and credit. Captions with `caption-side=overlay` take no space.

### 11.2 Layers

- `background`: fills the whole scene behind everything. Never excludes text. `cols`, `rows`, `top` are ignored.
- `content`: normal placement. The only layer that can exclude text.
- `overlay`: drawn above content. Never excludes text.

### 11.3 Two placement modes

**Grid-placed**: the object is written directly inside a `\scene` (or `\group`). Position comes from `cols` plus `rows` (screen) or `top` (flow).

**Anchored**: the object is written inside a story or inline frame, between paragraphs. Its top edge sits on the baseline step of the line where it occurs, so it travels with the text across frames, scenes and breakpoints.

Anchored objects position horizontally in one of two ways:

| Attributes | Meaning |
| :---- | :---- |
| `side=full` (default) | Full width of the current frame column. Text stops above and resumes below. |
| `side=left` or `right`, `width=<length or %>` | Partial width inside the current column, text wraps beside it. `%` is of the column width. |
| `side=center`, `width=<length or %>` | Centred on the middle of its frame: in a frame of two columns, across the gutter between them, with the text of both columns wrapping it (`wrap-side=both` unless the author sets another); in one column, on that column's middle. `%` is of a column. Set from a band's first column, so in a banded frame it opens the next page, at its top, rather than reach over text already set; met where it cannot (a later column of a frame that is not banded, or the story ending in a later column), it centres in its own column. A gap beside it narrower than the style's `min-slot` takes no text. Added 2026-10-09. |
| `cols=<range>` | Absolute grid columns of the scene, regardless of which frame holds the anchor. Used for objects that hang in a margin column or straddle two frames. Text in any overlapping frame wraps. |

If an anchored object does not fit in the space left in its frame, it moves to the top of the next frame or column in the thread and the text continues without a gap.

**Pin and reflow.** An anchored object with `cols=` can reach into a column of the same frame that was filled before its anchor line was reached. When the anchor line is reached, the object's y is fixed. If its exclusion intersects lines already placed in this frame, the frame is laid out again from its first line with the object pinned at that y, even if the anchor line then moves. Laying out again can slide a line under a second object that cut into nothing before, so the frame is set again while a pass finds one, to a limit of three; pins accumulate, each object keeping the y of the pass that first caught it. An object still unpinned when the limit is reached stays where it is. Column balancing applies this rule inside each trial height and rejects a trial that leaves one.

### 11.4 `\figure`

Images, including GIF.

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `src` | path | required | Give the highest resolution available. The compiler generates the responsive set (sizes, modern formats). Use `src@phone=` for art direction. |
| `alt` | string | none | Missing `alt` is a warning. `alt=""` marks a decorative image and is silent. |
| `ratio` | ratio | `auto` | Box aspect ratio. `auto` uses the image's own. |
| `fit` | `cover` `contain` `fill` `none` | `cover` | How the image fills its box |
| `focus` | pair of percentages | `"50% 50%"` | Focal point kept in view when `fit=cover` crops |
| `shape` | `rect` `circle` `ellipse` `alpha` `poly(...)` | `rect` | §12.2 |
| `clip` | boolean | `false` | Clip the image to `shape` (clipping path) |
| `caption-side` | `below` `above` `overlay` | `below` | |
| `loading` | `lazy` `eager` | `lazy` | `eager` for first-scene heroes |

Body: optional `\caption`, `\credit`.

GIF: same command. JPEG, PNG and GIF pictures are served as WebP (2026-10-09): an animated GIF as an animated WebP, often five to ten times smaller, transparency kept; sizes and contours come from the original. Under reduced motion the first frame is shown.

### 11.5 `\video`

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `src` | path | required | |
| `poster` | path | none | Warning if missing on a non-background video |
| `alt` | string | none | Text description. Same warning rule as figures. |
| `captions` | path (`.vtt`) | none | |
| `play` | `manual` `visible` `auto` | `manual` | `visible` plays while in the viewport and pauses outside it |
| `loop` | boolean | `false` | |
| `muted` | boolean | `false` | `play=visible` or `auto` without `muted` is a warning; browsers will block it |
| `controls` | boolean | `true` | Default `false` when `layer=background` |
| `ratio` `fit` `focus` `shape` `clip` `caption-side` | | | As `\figure` |

Always rendered inline (never forced fullscreen on mobile). Body: optional `\caption`, `\credit`.

### 11.6 `\embed`

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `provider` | `youtube` `vimeo` `iframe` | required | |
| `id` | string | | For `youtube`, `vimeo` |
| `url` | path | | For `iframe` |
| `title` | string | none | Accessible name. Warning if missing. |
| `ratio` | ratio | `16:9` | |
| `poster` | path | provider thumbnail | |
| `facade` | boolean | `true` | Render a poster and load the real iframe on interaction |

Embeds are always rectangular: `shape` is not accepted. `caption-side` works as on `\figure`. Body: optional `\caption`, `\credit`.

### 11.7 `\lottie`

| Attribute | Type | Default |
| :---- | :---- | :---- |
| `src` | path (`.json`, `.lottie`) | required |
| `alt` | string | none |
| `play` | `manual` `visible` `auto` | `visible` |
| `loop` | boolean | `true` |
| `ratio` | ratio | from file |
| `shape` `clip` `alpha-threshold` `caption-side` | | | As `\figure` |

Under reduced motion the first frame is shown.

### 11.8 `\audio`

`src` (required), `title` (string, warning if missing), `captions` or `transcript` (path). Always shows controls. Never autoplays. Its caption is always below; `caption-side` is not accepted.

### 11.9 `\gallery`

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `layout` | `grid` `strip` | `grid` | `strip` is a horizontal swipe row |
| `per-row` | integer | `3` | `grid` only. Use `per-row@phone=1`. |
| `gap` | length | grid `gutter` | |
| `ratio` | ratio | `auto` | Forced on every child when set |
| `caption-side` | as `\figure` | `below` | For the gallery's own caption |

Body: `\figure` and `\video` children, optional `\caption`, `\credit` for the set. Children ignore their own placement attributes.

### 11.10 `\pullquote` and `\sidebar`

Text-bearing objects. They take the common attributes and the placement modes of §11.3, and their own `style=`.

- `\pullquote[...]{Quote text \cite{Name}}`. Default `side=full` when anchored. Typical: `[side=right, width=50%, wrap=rect]`.
- `\sidebar[...]{ \title{By the numbers} paragraphs... }`. Accepts `bg`, `inset`, `border` (`none` or `rule`), and `portrait`: the box narrows from its slot's width to the widest that is still taller than wide (never under 10em of its text), keeping its right edge when `side=right`, so a fact box reads as a panel beside the text rather than a slab of it (added 2026-09-28). May contain figures. Its text is its own small story and does not thread.

### 11.11 `\group`

A box on the grid that holds objects, frames and other groups, and treats them as one unit for placement, wrap, reveal and `hide`. Its children ignore their own `cols`, `rows` and `top`: the group decides where they go, inside the group's own columns. A group never defines new columns, so this is not a nested grid.

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `layout` | `stack` `row` | `stack` | `stack`: children one below another at the group's width. `row`: children pack into rows of whole grid columns that wrap. |
| `gap` | length | `1bl` | In a stack, the space between children; in a row group, between rows. Items in a row are separated by the grid gutter. |
| `valign` | `top` `center` `bottom` `stretch` `text` | `top` | Row groups: how a child shorter than its row sits in it. `stretch` gives every child the row's height; media fill it (cropping under `fit=cover`), and a text frame takes it as a definite height, its story continuing in the thread's next frame. `text` (2026-09-30): the row is as tall as its tallest text frame (with none, its tallest child), and every child takes that height, media cropped to it: a photograph as tall as the heading beside it. |
| `stagger` | time | `80ms` | Between children that take the group's reveal |

**Row groups.** The row is the group's column span, `N` columns. A child is **fixed** when it has `width`, and otherwise **fills**: it is at least `min-width` wide (default one column) and grows up to `max-width` (default the whole row). Widths round to whole columns: `min-width` up, `max-width` down, `width` to the nearest, never below one column or above `N`. Packing, at every viewport width:

1. Children go into rows in source order. A child joins the current row if the row's minimum widths still fit in `N`, and otherwise starts a new row. A child is never split; one wider than `N` takes the whole row.
2. In every row but a short last one, the spare columns are shared evenly between the fill children, extras to the earliest. A child that reaches its `max-width` stops, and the others share what it cannot take. Anything left stays empty at the row's end.
3. The last row, when there is more than one, keeps the columns of the row above: each fill child grows by that row's per-child share of its spare columns, and the rest of the row stays empty. Five photos of `min-width=3col` on 12 columns are rows of four and one, all 3 columns wide.
4. Each row is as tall as its tallest child. The first row starts at the group's top; each next row starts `gap` below the previous one, on the next baseline step.

A text frame's height in a row is its last line, not its last paragraph's space after. Hidden children take no place.

**Nesting.** A stack inside a row is one row item, and its children stack at the width the row gave it: this is how a photo and its headline stay together when a row breaks. A row inside a stack or another row packs into the width its parent gave it.

**Reveal.** The group itself does not animate. The reveal it is given (its own `enter`, or its scene's, or its parent group's) passes to each child that has no `enter` of its own, `stagger` apart, in source order.

**Wrap.** Siblings in a group never overlap, so children's own `wrap` does nothing inside it. To text outside, the group is one object: with `wrap=rect` its bounding box excludes text in frames placed after it.

A group is placed in a scene. A group anchored in a story is not in this version.

```
\group[layout=row, cols=all]{
  \group[min-width=7col]{                         %% a stack: the photo and headline travel together
    \figure[src=/weaver.jpg, alt="…", ratio=16:10]
    \frame{\headline{The keeper of thread}}
  }
  \figure[src=/look.jpg, alt="…", min-width=4col, max-width=5col, ratio=4:5]
}
```

On 12 columns the stack and the photo sit side by side, 8 and 4 columns wide; on a phone each takes a full-width row, photo, headline, then the second photo. No `cols@phone` is needed.

---

## 12 Text wrap

Wrap is declared on the object that pushes text away. Only `layer=content` objects can wrap.

### 12.1 Attributes

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `wrap` | `none` `rect` `contour` `jump` | `rect` for anchored objects with `side=left/right/center` or `cols`; `jump` for `side=full`; `none` for grid-placed objects | `none`: text ignores the object (it overlaps). `jump`: text skips the object's full vertical extent. |
| `wrap-side` | `both` `left` `right` `largest` | `largest` | Which side(s) of the object text may occupy. `both` sets text in two slots per line band. |
| `wrap-offset` | length | `1bl` | Standoff between the exclusion and the text |
| `alpha-threshold` | percentage | `50%` | Only with `shape=alpha`. On `\figure`, `\video`, `\lottie`. |

An object whose box spans a column's whole width leaves that column only slivers beside its outline, so the column's text goes above and below it instead, unless `wrap-side=both` asks for both sides (added 2026-09-28). Columns it only cuts into wrap it as usual.

Grid-placed objects default to `wrap=none` so placing a figure next to a frame does nothing surprising. Set `wrap=rect` or `contour` to make it cut into any frame it overlaps.

### 12.2 Shapes and contours

`wrap=contour` uses the object's `shape`:

| `shape` | Exclusion |
| :---- | :---- |
| `rect` | The box (same as `wrap=rect`) |
| `circle` `ellipse` | Inscribed in the box |
| `alpha` | The silhouette of the image's alpha channel. Requires an image with transparency (warning and fallback to `rect` otherwise). For video and Lottie, taken from the poster or first frame. |
| `poly(x y, x y, ...)` | Author polygon in normalized box coordinates, `0 0` top-left to `1 1` bottom-right |

Contract for `alpha`: at build time the compiler traces the alpha channel (threshold 50% by default, `alpha-threshold=` to change), simplifies it to a polygon, and stores it in normalized coordinates. At layout time the polygon is scaled to the object's box and expanded by `wrap-offset`. For each line band the exclusion is the polygon's horizontal extent across the whole band (top to bottom of the line), not at a single y. `fit` and `focus` crops are applied before tracing so the contour matches what is visible.

For each line band the exclusion is a **list** of free intervals, even though a v1 shape always yields one (the polygon's leftmost-to-rightmost extent across the band). Measured on a 40-point concave silhouette, 12 of 13 crossed bands were genuinely single-interval and the thirteenth lost about 112px of line width where a notch opened toward the text. The single-interval rule stays for v1, because its failure is a slightly short line and never misplaced text, but the API returns a list so multi-interval bands are a later change inside one function.

Contours are resolution-independent, so the same contour works at every breakpoint.

---

## 13 Reveals

The only motion in v1. A reveal animates an element from a start state to its laid-out state (enter) or away from it (exit).

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `enter` | `none` `fade` `rise` `drop` `slide-left` `slide-right` `zoom` `wipe` | `none` | |
| `exit` | same set | `none` | Plays when the element leaves through the top of the viewport |
| `enter-at` | percentage | `15%` | How far the element must be inside the viewport before enter fires |
| `duration` | time | `600ms` | |
| `delay` | time | `0ms` | |
| `ease` | `standard` `in` `out` `linear` | `standard` | |
| `replay` | boolean | `false` | Replay enter each time the element comes back into view |
| `stagger` | time | `80ms` | On scenes, parents and groups: delay step between children that have no `enter` of their own |
| `motion` | `always` | none | Only value is `always`: keep this element's motion under reduced motion (rule 3). Emits a warning. Same carriers as `enter`. |

Hard rules:

1. Reveals use opacity, transform and clip only. They MUST NOT affect layout. Text is always laid out in its final position first.
2. Content MUST be present and readable without JavaScript and before any reveal fires for elements in the first viewport.
3. Under the user's reduced-motion setting every reveal resolves to `none`, animated media shows a still, and `play=visible|auto` becomes `manual`, and a page `turn` resolves to `none`. An author can force motion on one element with `motion=always`, which emits a warning.

---

## 14 Accessibility and reading order

- **DOM order follows story order**, not visual position. Anchored objects are emitted at their anchor point. Grid-placed objects are emitted in source order within the scene. This is the renderer's default behavior and needs no author input.
- `\headline` is `h1`; `\subhead` is `h2`/`h3`; `\blockquote`, `\figure` + `\caption`, `\cite` map to their HTML equivalents; each scene is a `section`.
- Laid-out text MUST remain real, selectable, searchable text.
- Missing `alt` on `\figure`, `\video`, `\lottie`, missing `title` on `\embed`, `\audio`: **warnings**, not errors.
- Reduced motion: §13 rule 3.

---

### 14.1 Read assist

A reader's aid for keeping their place (2026-10-09), part of every rendered article where a pointer can hover; nothing in the source turns it on or off. A circle at the top of the screen's right edge, under the sound control (§10.6) when there is one, on the line of the page dots, shows an icon and no words; hovering it (or focusing it) fans out three circles below it: **Colour**, **Soft wash** and **Focus**. Choosing one turns it on, choosing it again turns it off; it is off until the reader chooses, and the choice is kept in the reader's browser for every article.

Each marks the line under the pointer, line by line. Where reading jumps, the line on the other side of the jump is marked with it, from either side (2026-10-10): a paragraph's last line with the next paragraph's first, and a column's (or page's) last line with the next column's first, so the reader sees where to go on and, having gone on, where they came from. Only what changes is redrawn: a line that stays marked keeps its mark, so moving from line to line, or across the space between paragraphs, does not flicker; a line leaving fades out and a line arriving fades in. Colour sets the marked lines in the page's accent; Soft wash lays a faint accent band behind them, beside a drop cap from the text itself so the cap stays clear; Focus fades all other running text to 40%.

The pointer is followed by line: lines fill their whole line height and touch, so moving between lines never drops the mark, and when the page scrolls under a still pointer the mark moves to the line now under it. It fades only after the pointer has been away from running text for 0.6 seconds. The read-assist and sound controls take no focus from a mouse click, so the space bar keeps scrolling the page (§08.3) instead of pressing the control again; the keyboard still reaches them with Tab. Only running text takes part (prose and the lede); nothing moves or changes size. Under reduced motion nothing animates.

(2026-10-09 and 10: a sentence-based passage was tried first, a three-line window around the pointer, and a fourth choice, a turn arrow in the margin; all set aside.)

## 15 Compiler contract

### 15.1 Pipeline

```
.wmx source (+ optional .wmxt theme)
  1. LEX      -> tokens with source positions
  2. PARSE    -> AST (schema-validated commands, attributes, bodies)
  3. RESOLVE  -> Resolved Document (viewport-independent)
  4. LAYOUT   -> Positioned Document (for one viewport size)
  5. RENDER   -> DOM
```

Stages 1 to 3 run at build time. Stages 4 and 5 run in the browser at the real viewport size and re-run on resize and when fonts finish loading. **Stage 3 to 4 is a browser boundary, not a pure-function boundary**: text measurement needs a host measurement API (canvas), so stages 4 and 5 cannot run in plain Node. A build MAY run 4 and 5 at representative widths in a headless browser to ship pre-positioned HTML, but see §15.4 on cross-engine line breaks before doing so.

**Resolve** does: load theme, apply the cascade, expand tokens, resolve `extends` and `parent`, bind default styles, build threads, expand responsive attributes into one complete value set per breakpoint, validate every placement against every breakpoint's grid (apply the linearize rule), trace alpha contours, generate responsive image sets.

**Layout** does: grid geometry for the viewport, object boxes, exclusion shapes, line placement through every thread (§09.6), column balancing, overset policy, final scene heights.

Resolve is a pure function with no DOM access. Layout reads no DOM and performs no measurement of its own (see §15.4); it is pure arithmetic over widths the prepare step cached. Layout input is `(ResolvedDocument, viewport width, viewport height, prepared paragraphs)`.

### 15.2 AST

```ts
type Document = {
  version: 1
  frontmatter: Frontmatter
  definitions: Command[]
  stories: Command[]
  scenes: Command[]
}

type Node = Command | Paragraph

type Command = {
  kind: "command"
  name: CommandName
  attrs: Attr[]
  body: Node[] | null
  source: Pos
}

type Attr      = { key: string; at: string | null; value: Value; source: Pos }
type Paragraph = { kind: "paragraph"; runs: Inline[]; source: Pos }
type Inline    =
  | { type: "text"; value: string }
  | { type: "bold" | "italic" | "code"; runs: Inline[] }
  | { type: "link"; href: string; runs: Inline[] }
  | { type: "span"; style: string; runs: Inline[] }
  | { type: "br" }
type Pos = { line: number; column: number; length: number }
```

The AST round-trips: `format(parse(src))` is canonical source, and formatting canonical source is a no-op. One meaning has one spelling.

### 15.3 Resolved Document

JSON-serializable, snapshot-testable. Shape (informative):

```ts
type ResolvedDocument = {
  meta: Frontmatter
  breakpoints: Breakpoint[]
  fonts: FontFace[]
  stories: { name: string; overset: Policy; content: Block[] }[]
  scenes: {
    name: string
    perBreakpoint: Record<BreakpointName | "base", {
      grid: GridValues
      palette: PaletteValues
      height: "flow" | "screen" | "page"
      turn: { effect: "fade" | "slide"; durationMs: number; ease: Ease } | null
      linearized: boolean
      frames: ResolvedFrame[]      // placement, columns, story ref, fully-valued
      objects: ResolvedObject[]    // placement, media, wrap shape polygon, reveal
    }>
  }[]
  threads: Record<StoryName, Record<BreakpointName | "base", FrameRef[]>>
}
```

Every value in it is concrete. No tokens, no `extends`, no defaults left to look up.

**Positioned Document** is layout's output and the renderer's only input. Frozen from the 0.2 layout spike:

```ts
type PositionedDocument = {
  viewport: { width: number; height: number }
  breakpoint: string
  scenes: PositionedScene[]
  height: number
}

type PositionedScene = {
  name: string
  y: number                  // document space, not scene-relative
  height: number
  grid: GridGeometry
  lines: PositionedLine[]    // STORY order, never visual order
  objects: PositionedObject[]
}

type PositionedLine = {
  story: string; block: number; style: string; frame: string; column: number
  x: number; y: number
  baseline: number           // stored, not derived: the snapping rule lives in one place
  width: number              // the slot
  measured: number           // the text; a large gap flags a too-narrow band
  height: number
  text: string
  start: TextCursor; end: TextCursor
  paragraphStart: boolean
  snapped: boolean
}

type PositionedObject = {
  name: string; kind: string
  box: { x: number; y: number; width: number; height: number }
  exclusion: Exclusion | null
  anchoredAt: number | null
}

type TextCursor = { seg: number; grapheme: number }
```

`lines` in story order is what makes the DOM-order requirement of §14 free: the renderer emits in array order and never sorts. Cursors are plain data so the whole structure round-trips through JSON for snapshot tests.

### 15.4 Text engine contract

The spec does not name a text engine. Any engine that satisfies this contract works:

1. **Prepare**: given styled text runs and loaded fonts, produce a reusable prepared paragraph. Measurement MUST match how the browser renders the same font.
2. **Next line**: given a prepared paragraph, a cursor and a max width, return the next line (text range, measured width, end cursor) or null at the end. The width may differ on every call.
3. **Cursor**: serializable and resumable, so a paragraph can start in one frame and continue in another.
4. **Hyphenation**: honors soft hyphens inserted by the compiler's hyphenation pass for `lang`.
5. **Measurement happens only in prepare.** Prepare may use the host's text measurement API and MUST warm its cache for every segment it will later be asked about, at any width. `nextLine` MUST NOT measure: given a prepared paragraph it is arithmetic over cached widths. An engine adapter that skips the warm-up makes layout silently impure, so the engine's own test suite MUST assert zero measurement calls during layout.
6. **Prepared paragraphs are cached per breakpoint.** A breakpoint change re-prepares; keeping the previous breakpoint's prepared paragraphs makes a return to it free. Prepare dominates the cost of a device rotation.
7. Layout MUST be deterministic within one browser engine. Line breaks MAY differ between engines for the same font and text (Gecko is known to differ from Blink and WebKit), so anything that compares layouts, including screenshot tests and pre-positioned HTML, must pin one engine.

Variable width per line gives contour wrap. A resumable cursor gives threading. Those two capabilities are the whole requirement. (The current implementation candidate, `@chenglou/pretext`, exposes exactly this shape.)

### 15.5 Determinism

Same source, theme, assets, fonts, viewport size **and browser engine** give the same Positioned Document. No randomness, clocks or environment lookups in stages 1 to 4. Determinism is not promised across browser engines; see §15.4 point 7.

### 15.6 Errors and warnings

| Category | Stage | Fails build | Examples |
| :---- | :---- | :---- | :---- |
| Lex error | 1 | Yes | Invalid UTF-8, unterminated string |
| Parse error | 2 | Yes | Unknown command or attribute, wrong value type, unbalanced braces, child not allowed here, top-level content mixed with scenes |
| Resolve error | 3 | Yes | Unknown grid/style/palette/story/token, token cycle, overlapping breakpoints, story with no visible frame at a breakpoint, `rows=` in a flow scene, `overset=error` triggered at a test width |
| Resolve warning | 3 | No | Body-styled frame wider than 90 characters at a test width with no `measure` set (`W041`), scene or anchored object linearized by fallback, missing `alt`/`title`/`poster`, autoplay without `muted`, `snap=hard` on a flow scene, `shape=alpha` on an opaque image, more than one `\headline`, `motion=always`; readability (2026-10-09, after the readability research): body text under 16px (`W060`), body leading under 1.4 of its size (`W061`), an ink, muted or accent colour under 4.5:1 against its paper (`W062`, WCAG 2.2 AA), body weight under 350 (`W063`). Each warns once, naming the breakpoints or scenes it shows at |
| Asset warning | 3 to 5 | No | Missing file, font failed to load |
| Layout warning | 4 | No | `\framebreak` with nowhere to go (`W040`), overset clipped, no slot in a band meets the minimum width (`W042`), anchored object taller than every remaining frame, anchored object taller than a band (`W043`), body lines outside about 45 to 75 characters at a test width, under 30 on a phone (`W064`; `wmx check` estimates it with a fixed-width engine at 0.46em a character, Georgia's average) |

Every diagnostic carries: file, line, column, category, code, message, and a suggested fix where one exists.

```
wmxdsl: parse error [P012] at castle.wmx:14:8
  Unknown command \pullqoute. Did you mean \pullquote?

wmxdsl: resolve warning [W031] at castle.wmx:52:3
  \figure cols=9-12 does not fit grid "feature" at breakpoint "phone" (4 columns).
  Scene "body-1" will linearize on phone. Add cols@phone=... or linearize@phone=true.
```

Test widths for build-time layout checks default to 360, 768, 1280, 1470 and 2560px. The last is wider than the default grid `max`, so it exercises the centering and growing-margin path in §07.5.

---

## 16 Built-in default theme

What you get with no design head at all. Implementers ship this as a real `.wmxt` file. The built-in
theme is **Vanilla**, set value by value from 2026-09-27 to
2026-10-07; it replaced the first placeholder theme on
2026-10-07.

**Breakpoints**: `phone` max 639px, `tablet` 640 to 1023px, `compact` 1024 to 1419px, base 1420 to 1799px, `wide` 1800px and up. `compact` is base with the body a pixel smaller on a 31px grid (2026-10-07).

**Grid `default`**: a baseline grid of one body line, so every line of text in side-by-side columns
shares its baseline.

| | base | wide | tablet | phone |
| :---- | :---- | :---- | :---- | :---- |
| `cols` | 12 | 12 | 8 | 4 |
| `gutter` | 24px | 24px | 20px | 16px |
| `margin-x` | 128px | 128px | 72px | 28px |
| `margin-y` | 2bl | 2bl | 2bl | 1.5bl |
| `baseline` | 33px (compact 31px) | 33px | 30px | 28px |
| `body` | 4-9 | 4-9 | 2-7 | all |
| `max` | 1440px | 1760px | 1440px | 1440px |
| `outdent` | 0 | 25% | 0 | 0 |
| `rows` | 6 | 6 | 6 | 6 |

**Palette `default`**: paper `#f6f7f8`, ink `#16181d`, muted `#5f6570`, accent `#1f5fbf`, rule `#dde1e6`.

**Styles**. Families: serif = `Georgia, serif`; sans = `Helvetica Neue, Helvetica, Arial, sans-serif`.
Sizes are base and wide / tablet / phone where they differ.

| Style | Family | Size | Leading | Other |
| :---- | :---- | :---- | :---- | :---- |
| `body` | serif | 21px (compact 20px) / 19px / 18px | 1bl | align justify, justify-min 12em, indent 2em, space-after 0, min-slot 9em, composer paragraph, hyphenate (hyphenate-min 6, hyphenate-caps false), hang punctuation, widows 2, orphans 2 |
| `lede` | serif | 22px / 22px / 20px | 1.45em | space-after 0.5bl, snap none, balance, bind-short, no hyphenation |
| `headline` | serif, weight 700 | fluid(35px, 61px) | 1.05em | tracking -0.01em, space-after 0.35bl, snap none, balance, bind-short, no hyphenation |
| `deck` | serif, italic | fluid(21px, 26px) | 1.3em | color muted, space-after 0.5bl, snap none, balance, bind-short, no hyphenation |
| `kicker` | sans, weight 600 | 13px | 0.5bl | case upper, tracking 0.08em, color accent, space-after 0.25bl, snap none |
| `byline` | sans, weight 600 | 16px | 0.75bl | space-after 0, snap none |
| `meta` | sans | 13px | 0.75bl | color muted, space-after 0, snap none |
| `subhead` | sans, weight 600 | 18px | 1bl | case upper, tracking 0.08em, color accent, space-before 1bl, space-after 0, keep-with-next, balance, bind-short |
| `subhead-2` | sans, weight 700 | 20px | 1bl | space-before 1bl, space-after 0, keep-with-next |
| `pullquote` | serif, italic | fluid(22px, 28px) | 1.25em | color ink, space-after 0, snap none, balance, bind-short, mark `"“”"` |
| `cite` | as the enclosing style | 17px | 1.2em | color muted, upright |
| `blockquote` | serif, italic | 20px | 1bl | indent via frame inset 1col, hang punctuation |
| `caption` | serif, italic | 15px | 1.4em | color muted, snap none |
| `credit` | sans | 13px | 1.4em | case upper, tracking 0.06em, color muted, snap none |
| `sidebar` | sans | 16px | 1.5em | snap none |
| `dropcap` | as headline: serif, weight 700 | spans 3 lines | | color accent |
| `bio` | sans, italic | 16px | 0.75bl | color muted, snap none |
| `folio` | sans, weight 600 | 12px | | case upper, tracking 0.08em |
| `link` | inherits | inherits | | character style, color accent, underlined |
| `code` | monospace | 0.9em | | character style |
| `title` | as `sidebar`, weight 700 | as `sidebar` | as `sidebar` | no hyphenation; sidebar and box titles |
| `endmark` | as the enclosing paragraph | | | color accent |

An empty cell takes the §07.6 default, whose column applies to every style, not only `body`.

---

## 17 Versioning

`wmxdsl: 1` in frontmatter selects the language major version.

Breaking (needs a new major): removing or renaming a command or attribute, changing a type or accepted values incompatibly, changing a default in a way that changes rendering, changing lexical rules.

Non-breaking: new commands, new attributes with defaults, new enum values.

---

## 18 Complete example

```
---
wmxdsl: 1
title: Stone & Strategy
lang: en
---

%% ---------- design head ----------
\font[family="Tiempos Text", src=/fonts/tiempos-text.woff2, weight=400]
\font[family="Tiempos Text", src=/fonts/tiempos-text-italic.woff2, weight=400, italic]
\font[family="Tiempos Headline", src=/fonts/tiempos-headline.woff2, weight=700]

\token[name=ember, value=#e0563a]
\palette[name=night, paper=#0d0d0f, ink=#f2efe9, muted=#9a968e, accent=$ember, rule=#2a2a2e]

\grid[name=feature, cols=12, gutter=24px, margin-x=64px, max=1440px, baseline=28px, rows=6, body=4-9]
\grid[name=feature, at=tablet, cols=8, gutter=20px, margin-x=40px, baseline=27px, body=2-7]
\grid[name=feature, at=phone,  cols=4, gutter=16px, margin-x=20px, baseline=26px, body=all]

\style[name=body, family="Tiempos Text, serif", features="liga kern onum"]
\style[name=headline-xl, extends=headline, family="Tiempos Headline, serif",
       size=fluid(44px, 104px), tracking=-0.02em]

\parent[name=interlude, grid=feature, height=screen, palette=night, snap=hard, enter=fade]

\folio[position=top-left, progress]{Architecture Today · Heritage}

%% ---------- story ----------
\story[name=main]{
  \dropcap[lines=3]
  Stone endures where nearly everything else decays. Long after the commanders
  who ordered their construction have been forgotten, the great fortifications
  of medieval Europe continue to impose their presence on the landscapes they
  were built to dominate.

  The history of European fortification is a history of problem and response.

  \pullquote[side=right, width=50%, wrap=rect, wrap-offset=1bl, enter=rise]{
    Stone remembers even when the stone-cutter does not.
  }

  \subhead{Landscape as defence}

  What the builders understood above all was the relationship between landscape
  and defence. The most formidable fortifications were never merely strong in
  themselves.

  \framebreak

  \figure[src=/img/keep-cutout.png, alt="The keep at Carcassonne, cut out against white",
          cols=7-12, cols@tablet=5-8, shape=alpha, wrap=contour, wrap-side=left,
          wrap-offset=16px, enter=fade]{
    \caption{The keep at Carcassonne, restored in 1853 by Viollet-le-Duc.}
    \credit{Jean-Pierre Dalbéra / CC BY 2.0}
  }

  By the fourteenth century the logic had inverted. Walls grew lower and
  thicker as artillery made height a liability. \endmark
}

%% ---------- scenes ----------
\scene[name=opener, grid=feature, height=screen, palette=night, snap=hard, stagger=120ms]{
  \video[src=/video/ramparts.mp4, poster=/img/ramparts.jpg, alt="", layer=background,
         fit=cover, focus="50% 70%", play=visible, loop, muted]

  \frame[cols=1-8, rows=4-6, cols@tablet=1-7, cols@phone=all, valign=bottom, enter=rise]{
    \kicker{Essay · Heritage}
    \headline[style=headline-xl]{Stone \br & Strategy}
    \deck{How the great fortifications of medieval Europe shaped a continent.}
    \byline{Dr. Helena Müller}
    \meta{June 2026 · 11 min read}
  }
}

\scene[name=part-one, grid=feature]{
  \frame[story=main, cols=1-8, columns=2, cols@tablet=all, cols@phone=all, columns@phone=1]

  \sidebar[cols=9-12, top=0, bg=rule, inset=1bl, hide@tablet, hide@phone, enter=fade]{
    \title{By the numbers}
    1,200+ surviving castles in France alone.

    150 years: average construction time.
  }
}

\scene[name=breath, parent=interlude]{
  \figure[src=/img/valley.jpg, alt="Fog over the Aude valley at dawn", layer=background,
          focus="30% 60%", src@phone=/img/valley-portrait.jpg]
  \frame[cols=3-10, rows=3-4, cols@phone=all]{
    \pullquote{The wall was never the defence. The valley was.}
  }
}

\scene[name=part-two, grid=feature]{
  \frame[story=main, cols=1-10, cols@tablet=all, cols@phone=all]
  \frame[cols=1-6, cols@phone=all]{
    \rule
    \bio{Dr. Helena Müller teaches architectural history at Heidelberg.}
  }
}
```

What happens: the `main` story threads through `part-one` (a balanced two-column frame that takes everything up to `\framebreak`), skips the `breath` scene, and resumes in `part-two`, where the keep's alpha silhouette cuts into the text from the right. On phone everything is one column, the sidebar is hidden, the interlude image swaps to a portrait crop, and the contour figure, which is anchored, linearizes by itself (§07.5) with a warning unless `cols@phone` is added to it. On tablet the `breath` scene linearizes, because its frame's `cols=3-10` has only a phone override and the tablet grid has 8 columns.

**Minimum valid file**

```
---
wmxdsl: 1
title: A Brief Note
---
\headline{A Brief Note}

This is the entire article.
```

---

## 19 Glossary

**Anchored object**: an object written inside a story; it moves with the text.
**Baseline step (`bl`)**: the grid's vertical unit. Body lines sit on it.
**Bleed**: extending an object through the margin to the viewport edge.
**Contour**: a non-rectangular wrap outline, from a shape, polygon or alpha channel.
**Exclusion**: the area an object removes from the space available to text.
**Frame**: a rectangle on the grid that displays text.
**Gutter**: the space between grid columns.
**Linearize**: the fallback that stacks a scene into one column when its placements do not fit a breakpoint's grid.
**Overset**: text that does not fit in the frames of its thread.
**Parent**: a scene template (print's master page).
**Reveal**: an enter or exit animation that does not affect layout.
**Scene**: a full-width band of the article with its own grid and palette.
**Slot**: a free horizontal interval in one line band after exclusions.
**Story**: a named run of content with no position of its own.
**Thread**: the ordered frames one story flows through.

---

## Appendix A: Command index

| Command | Body | Where allowed |
| :---- | :---- | :---- |
| `\font` `\token` `\palette` `\breakpoint` `\grid` `\style` | none | Design head, theme file |
| `\parent` | as scene | Design head, theme file |
| `\folio` | inline text | Document level, parent |
| `\story` | story content | Document level |
| `\scene` | frames, objects, groups, or shorthand content | Document level |
| `\frame` | none (threaded) or story content (inline) | Scene, parent, group |
| `\group` | objects, frames | Scene, parent |
| `\kicker` `\headline` `\deck` `\byline` `\meta` `\lede` `\subhead` `\bio` | inline text | Story content |
| `\blockquote` | paragraphs, `\cite` | Story content |
| `\dropcap` `\framebreak` | none | Story content |
| `\rule` | none | Story content, scene |
| `\music` | none | Story content, scene |
| `\br` `\endmark` | none | Inline |
| `\span` | inline text | Inline |
| `\figure` `\video` | `\caption`, `\credit` | Scene, group, story content, gallery, sidebar |
| `\embed` `\lottie` `\audio` | `\caption`, `\credit` | Scene, group, story content |
| `\gallery` | figures, videos, `\caption`, `\credit` | Scene, group, story content |
| `\pullquote` | paragraphs, `\cite` | Scene, group, story content |
| `\sidebar` | `\title`, paragraphs, figures | Scene, group, story content |
| `\caption` `\credit` | inline text | Media objects, gallery (`\credit` also in story content) |
| `\title` | inline text | Sidebar |
| `\cite` | inline text | Pull quote, block quote |

"Story content" means the body of a `\story`, an inline `\frame`, or a scene using the shorthand form.

## Appendix B: Changes from WMX 0.1

- Renamed to WMXDSL. Version key is `wmxdsl`. Extension stays `.wmx`.
- Design moved into the language: `\grid`, `\style`, `\font`, `\palette`, `\token`, `\breakpoint`, `\parent`, theme files. Frontmatter is metadata only.
- Fixed layout registry removed. Scenes, frames and stories replace it.
- Page model replaced by scroll scenes (`flow`, `screen`), snap and reveals.
- Threading, `\framebreak`, overset policy, multi-column frames and balancing added.
- Wrap generalized: `wrap`, `wrap-side`, `wrap-offset`, `shape` (incl. `alpha`, `poly`), `clip`.
- Responsive model added: breakpoints, `key@breakpoint`, `at=`, fluid values, linearize fallback.
- Media added: `\video`, `\embed`, `\lottie`, `\audio`, `\gallery`. `\image` merged into `\figure`; `src` is now an attribute.
- Roles (static-chrome, stream-inline, obstacle) removed. Source order inside a story is always meaningful; position comes from frames and placement attributes.
- `\dropcap` is a marker and no longer splits a word. `\runninghead` became `\folio`. `\standfirst` and `\creditline` removed. `\lede`, `\blockquote`, `\rule`, `\endmark`, `\bio`, `\cite`, `\span`, `\br`, `\group` added.
- `align=justify` added (§07.6), moved out of the deferred list (§01.3).
- Reading rules (2026-10-07, §07.6, §10.4): style attributes `composer`, `hyphenate-min`, `hyphenate-caps`, `justify-min`, `hang`, `bind-short`, and `quote` on `\dropcap`. All default to the earlier behaviour.
- `max-width` added to every object (§11.1) and `columns=auto` to frames (§09.2): on a wide screen an object holds its size instead of growing with the grid, and a frame takes more columns instead of longer lines.
- Row groups added (§11.11): `\group[layout=row]` packs its children into rows of whole grid columns that wrap, sized by `width`, `min-width` and `max-width`, with `valign` and nesting. Removed from the deferred list (§01.3).
- `side=center` on anchored objects (§11.3, 2026-10-09): across the middle gutter of a two-column frame, text wrapping on both sides.
- `\music` (§10.6, 2026-10-09): soundtrack cues that crossfade, stop or carry on as the reader scrolls.
- Comment marker changed from `%` to `%%`.
- Removed: CMS, AI pipeline, Studio, Astro rendering contract, school-specific notes, migration tooling, format comparisons, cover layout, print and PDF references, sidebar bullet lists (lists are deferred).