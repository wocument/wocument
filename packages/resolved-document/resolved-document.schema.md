# Resolved Document schema, format version 1

The Resolved Document is the only thing that crosses the build/browser boundary
(spec §15.1). The resolver writes it in Node; layout and the renderer read it in
the browser and cannot ask the resolver anything. This document is the contract
between them.

| File | Role |
| :---- | :---- |
| `src/resolved-document.ts` | **Source of truth.** TypeScript types, one doc comment per field. |
| `resolved-document.schema.json` | JSON Schema (draft-07), **generated** from the types. For validating resolver output in tests. |
| `resolved-document.schema.md` | This file. Sections 1–7 are written by hand; §8, the field reference, is **generated** from the types. |
| `src/invariants.ts` | `checkInvariants(doc)`: the guarantees in §3 that JSON Schema cannot express. |
| `examples/` | The minimum valid file and "Stone & Strategy" (spec §18), resolved by hand, as typed TypeScript and as JSON. |

`npm run gen:resolved` regenerates the schema, §8 and the example JSON. `npm test`
fails if any of them is stale, if an example does not validate, or if an example
breaks an invariant. So the three artifacts cannot drift apart.

---

## 1. Reading a Resolved Document

A consumer does four things, in this order.

1. **Pick the variant.** Walk `breakpoints` and take the last entry whose
   `minWidth` is at or below the viewport width. `variants[entry.variant]` is
   now the whole world. Nothing in it refers to another variant.
2. **Find the text.** A run, a drop cap or an end mark holds `s`, an index into
   the document-level `strings`. Text is shared by every variant because bodies
   never vary by breakpoint.
3. **Resolve the three symbolic values that remain** (§4.1): lengths in `vw`,
   `vh`, `pct`, `col`, `bl` or `fluid`; palette roles; and style keys. Each
   needs only what the consumer already holds: the viewport, the scene's grid
   and palette, or the variant's style table.
4. **Follow references by id.** Threads name frames, blocks name anchored
   objects, objects name assets and stories. Every reference resolves (§3, G3).

Layout needs nothing else. It needs no language rules, defaults, cascade or
theme, and it never has to know that `\subhead` keeps with the next block,
because the style entry already says `keepWithNext: true`.

---

## 2. Shape at a glance

```
ResolvedDocument
├── format, version
├── meta                          frontmatter, defaults written in
├── breakpoints[]                 total half-open cover: minWidth -> variant
├── fonts[]                       registered faces
├── strings[]                     all text, once
├── assets{}                      images + srcsets, video, audio, lottie, vtt, polygons
├── variants{ base, tablet, phone, ... }
│   ├── styles{}                  flat, keyed by style key
│   ├── stories{}                 blocks: paragraph | object (anchor) | framebreak | rule
│   ├── scenes[]                  grid, palette, height, snap, folio, children refs
│   ├── frames{}                  every frame, hidden included
│   ├── objects{}                 every object, hidden included
│   └── threads{}                 story -> visible frames, in order
└── diagnostics[]
```

---

## 3. Guarantees

A document that validates against the JSON Schema **and** returns no errors from
`checkInvariants` holds all of these. G1–G7 are checked in code. G8–G11 are
properties of how the resolver builds the document, which a checker cannot
detect from the output alone. The resolver's own tests have to cover those.

| # | Guarantee | Checked by |
| :---- | :---- | :---- |
| G1 | **Lossless JSON.** No `undefined`, `NaN`, `Infinity`, functions, classes or cycles. `JSON.parse(JSON.stringify(doc))` is deep-equal to `doc`. | invariants |
| G2 | **Total breakpoint cover.** `breakpoints` starts at 0, strictly ascends, never repeats a variant in adjacent entries, and names only existing variants. `variants` has `base`, and every other variant is selected by some range. | invariants |
| G3 | **Every reference resolves.** String indices, asset ids (to an asset of the right kind), story, frame, object and scene ids, link indices, style keys. | schema + invariants |
| G4 | **The style table is exact.** Every referenced key exists in the variant's `styles`, and every key there is referenced. | invariants |
| G5 | **Back-pointers agree.** An `ObjectBlock` and its object's `AnchoredPlacement` name each other. A contained object sits at its stated index in its container. | invariants |
| G6 | **Named stories have one shape.** A `\story` has the same number of blocks in every variant, with the same kinds and the same anchored objects. Only per-breakpoint properties differ, so a thread cursor `{ block, at }` survives a rotation. | invariants |
| G7 | **Threads are exactly the visible frames.** For each story, `threads` lists its non-hidden frames in scene order and then source order. Every named story has at least one (spec §09.3). | invariants |
| G8 | **No omission.** Every field is present in every object. Absence is `null`, `[]`, `"auto"` or a `none` variant, as the field says. | schema (`required` everywhere) |
| G9 | **Identity is stable across variants.** An element that exists in several variants has the same id in each. Hidden elements stay in the tables with `hidden: true`. | resolver tests |
| G10 | **Concrete.** No tokens, `extends`, `parent`, `at`, unset defaults, shorthand scenes, implicit document form, or `@breakpoint` keys. Linearize is already applied to placements. | resolver tests |
| G11 | **Nothing viewport-dependent is computed.** No pixel positions, column widths, line breaks or font-size results. Only the inputs to them. | review |

---

## 4. Conventions

### 4.1 What "concrete" means

Concrete does not mean "pixels". `40vw` cannot be pixels at build time. It means
a value needs **at most the viewport, or the grid and palette of the scene where
it is used**, and no language knowledge.

- **Lengths** are `Len`: `px`, `vw`, `vh`, `pct`, `col`, `bl`, `fluid`. `rem`,
  `em`, tokens, and `bl` inside a grid definition are gone. `em` of a fluid size
  becomes a scaled `fluid`, which is exact. `pct` is always "of" the reference
  box the field's description names.
- **`bl` and `col` stay symbolic** outside grid definitions, because a story
  crosses scenes whose grids can differ.
- **Colors in styles are palette roles or hex.** Roles stay symbolic so a
  scene's palette restyles everything in it (spec §07.3). Palette values
  themselves are always hex: eight lowercase digits, alpha last.
- **Track ranges** have `all` and `end` resolved to numbers.
- **Ratios** have `auto` resolved to the media's intrinsic ratio.
- **Reveals** have scene, parent and group stagger baked into each child's
  `delayMs`.
- **Derived numbers are rounded to 4 decimal places**, so `1.05em` of a 36px size
  is `37.8`, not `37.800000000000004`, on every platform. Values the author wrote
  are kept as written.

### 4.2 Absence

There are no optional fields. Each field says how absence is written:

| Written as | Means | Example fields |
| :---- | :---- | :---- |
| `null` | Genuinely nothing | `Meta.description`, `Frame.measure`, `FigureObject.caption`, `ParagraphBlock.dropcap` |
| `""` vs `null` | Deliberately empty vs missing | `alt`: `""` is decorative and silent; `null` is missing and warned |
| `[]` | An empty list | `Meta.authors`, `TextRun.marks` |
| `"auto"` | Layout decides | `VerticalFlow.top`, `VerticalFlow.height`, `AnchoredPlacement.height` |
| A `none` variant | Off | `Wrap` `{ mode: "none" }`, `RevealKind` `"none"` |

### 4.3 Identity

Ids are strings and unique per kind: scenes,
frames, objects and stories are separate namespaces.

| Thing | Id |
| :---- | :---- |
| Named element | Its `name` |
| Unnamed scene | `scene-1`, `scene-2`... (spec §08.1) |
| Unnamed frame or object | `<command>-<n>` per command, in document order, skipping numbers an author name already uses |
| Instantiated from a parent | `<sceneId>/<parentChildId>` |
| Default frame | `<sceneId>/frame` |
| Anonymous story | `<ownerId>#text`, `<ownerId>#caption`, `folio#text` |
| Block | Index in `Story.blocks` |

### 4.4 Text

Paragraphs are flat lists of runs. The resolver has already:

- curled straight quotes per `lang`, across run boundaries, leaving escaped quotes
  straight (spec §10.2);
- replaced `--`, `---` and `...` with their characters (grammar §05.4);
- inserted U+00AD soft hyphens into runs whose style hyphenates at any breakpoint.
  A consumer strips them from a run whose active style has `hyphenate: false`;
- removed the drop cap's graphemes from the paragraph's runs and put them in
  `Dropcap.s`. The renderer emits the cap first, so the DOM text is whole.

`style` on a run is appearance, for the text engine. `marks` and `link` are
semantics, for the renderer. They are separate because they answer different
questions.

### 4.5 Style keys

A block style key is a style name. A run style key is composed: the block key,
then `+strong`, `+em`, `+code`, `+link` in that order when present, then
`+span:<name>` for each `\span` from outermost to innermost. Every key a variant
uses is a complete entry in its `styles` (G4). The composition (link color and
underline, `code` at `0.9em` of *this* paragraph's size) happens in the resolver.

---

## 5. Coverage of the build brief's checklist

| Area | Carried by | Spec |
| :---- | :---- | :---- |
| Document | `Meta` (title, lang, description, authors, date, section, socialImage, theme), `fonts` | §04, §07.1 |
| Breakpoints | `breakpoints` (half-open cover), one `Variant` per breakpoint plus `base` | §06.4, §07.4 |
| Grid | `Scene.grid`: `Grid` inputs per variant (cols, gutter, marginX, marginY, max, baseline, rows, rowGap, body) | §07.5 |
| Palette | `Scene.palette`: five hex roles per scene per variant | §07.3 |
| Styles | `Variant.styles`: `ResolvedStyle`, every §07.6 property flattened | §07.6 |
| Fluid values | `LenFluid` { min, max, from, to } in px | §06.3 |
| Stories | `Story.blocks`: `ParagraphBlock`, `ObjectBlock`, `FrameBreakBlock`, `RuleBlock` | §09.1, §10 |
| Inline runs | `TextRun` (style, marks, link), `BreakRun`, `EndmarkRun`; `strings` curled and soft-hyphenated | §10.2, §15.1 |
| Drop caps | `ParagraphBlock.dropcap`: lines, chars, cap text, style. **Measured width is on the prepared paragraph** | §10.4 |
| Frames | `Frame`: cols, `Vertical`, columns, columnGap, balance, valign, inset, **measure**, bg, z, hidden, reveal, story | §09.2 |
| Threads | `Variant.threads`: visible frames per story per variant | §09.3 |
| Scenes | `Scene`: id, parent (provenance), grid, palette, height, snap (downgraded), bg, linearized, folio, children | §08 |
| Objects | `ObjectElement` union: placement, layer, z, bleed, offsets, wrap, reveal, hidden, per-kind payload, `Caption` | §11 |
| Wrap | `Wrap` { none, jump, rect/contour with side and offset }, `Shape` with the traced polygon as a `PolygonAsset`, per variant | §12 |
| Reveals | `Reveal` on every frame and object: enter, exit, enterAt, duration, delay (stagger baked in), ease, replay, motion | §13 |
| Media | `ImageAsset` (srcset per format, intrinsic size), `VideoAsset`, `AudioAsset`, `LottieAsset`, `FileAsset` (vtt, transcript); poster, alt, play, loop, muted, controls on the object | §11.4–§11.9 |
| Diagnostics | `Diagnostic`: resolve and asset warnings with position, fix and variant | §15.6 |

Nothing in the language was widened or narrowed to fit. Where the spec could not
be represented as written, the schema carries it as-is and the problem is an
R-question.

---

## 6. Versioning and compatibility

- `format: "wmxdsl-resolved"` and `version: 1` identify the file. A consumer
  MUST reject a different `format` or a higher `version`.
- **Breaking, bumps `version`:** removing or renaming a field, changing a field's
  type or meaning, adding a value to a closed enum that consumers must handle,
  or weakening any guarantee in §3.
- **Non-breaking:** adding a field. Producers write every field they know.
  Consumers MUST ignore fields they do not know.
- The generated JSON Schema is the **producer's** contract and is strict: every
  field required, no unknown fields. A consumer on version 1 that meets a newer
  producer's extra fields ignores them and does not validate against this schema.
- The format version is independent of the language version (`meta.wmxdsl`).

---

## 7. Examples

| Example | Source | Resolved |
| :---- | :---- | :---- |
| Minimum valid file | spec §18 | `examples/minimum.ts`, `examples/minimum.resolved.json` |
| "Stone & Strategy" | spec §18 | `examples/stone-and-strategy.ts`, `examples/stone-and-strategy.resolved.json` |

Both are hand-resolved: no resolver exists yet. They are typed against
`ResolvedDocument`, validated against the JSON Schema, and pass
`checkInvariants`.

Resolving "Stone & Strategy" by hand found four things the spec's prose under
the example did not say, all since ruled and folded into the spec: `breath`
linearizes on **tablet** (W031); a hidden sidebar that does not fit the grid;
the anchored contour figure whose scene is unknown when resolving;
and `\title` and `\endmark` having no default style.

The second example leaves soft hyphens out of body text, for readability, and its
asset dimensions are illustrative. Everything else is what a resolver would
write.

---

## 8. Field reference

Generated from `src/resolved-document.ts`. Do not edit by hand. Types are listed
in reading order, starting from the root.

<!-- BEGIN GENERATED FIELD REFERENCE: npm run gen:resolved -->

### ResolvedDocument

The resolver's entire output and the layout engine's entire input (spec §15.1, §15.3). Every value is concrete: no tokens, `extends`, `parent`, defaults, shorthand or viewport-dependent result remains.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `format` | `"wmxdsl-resolved"` | Always `"wmxdsl-resolved"`. Lets a consumer reject a file that is not a Resolved Document before reading further. |
| `version` | `1` | Format major version. Bumped on any change that removes a field, changes a field's type or meaning, or weakens a guarantee in the schema document. Adding a field does not bump it. |
| `meta` | [`Meta`](#meta) | Frontmatter metadata, with defaults written in (spec §04). |
| `breakpoints` | [`BreakpointRange`](#breakpointrange)[] | Sorted, total cover of all viewport widths from 0 upward, each range naming the variant it selects (spec §07.4). The active variant is the last entry whose `minWidth` is at or below the viewport width. |
| `fonts` | [`FontFace`](#fontface)[] | Every registered font face, from theme and document (spec §07.1). Layout waits for the faces its active scenes use. |
| `strings` | `string`[] | All text of the document, once. Runs, drop caps and end marks refer to entries by index. Quotes are curled, dashes and ellipses substituted, and U+00AD soft hyphens inserted (spec §10.2, §15.4 point 4). |
| `assets` | Record<string, [`Asset`](#asset)> | Media files, generated responsive sets, text tracks and traced polygons, keyed by asset id. Shared by all variants so art-directed and repeated media is stored once (spec §11.4-§11.9, §12.2). |
| `variants` | [`Variants`](#variants) | One complete variant per breakpoint plus `base` (spec §06.4). Nothing in a variant falls back to another variant. |
| `music` | [`MusicCue`](#musiccue)[] | Soundtrack cues in document order (spec §10.6). The playing track is the last cue above the reading position. Empty when the document has none. |
| `diagnostics` | [`Diagnostic`](#diagnostic)[] | Resolve and asset warnings (errors fail the build and never reach here). Carried for tooling and for the runtime console; layout ignores them (spec §15.6). |

### Meta

Frontmatter, resolved (spec §04). Absent optional fields are written as `null` or `[]`, never omitted.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `wmxdsl` | `1` | Language major version from frontmatter `wmxdsl`. Always 1 (spec §17). |
| `title` | `string` | Document title for `<title>` and social cards. Independent of `\headline` (spec §04). |
| `lang` | `string` | BCP-47 language tag; `"en"` when the frontmatter sets none. Drives quote curling, hyphenation and the page's `lang` (spec §04, §10.2). |
| `description` | `string` \| `null` | Meta description, or `null` (spec §04). |
| `authors` | `string`[] | Author names from frontmatter `author`, a single string becoming a one-element list; `[]` when absent. Metadata only; the visible byline is a `\byline` (spec §04). |
| `date` | `string` \| `null` | ISO 8601 date string exactly as given, or `null` (spec §04). |
| `section` | `string` \| `null` | Section label, or `null` (spec §04). |
| `socialImage` | [`AssetId`](#assetid) \| `null` | Social card image, as an image asset id, or `null` (spec §04). |
| `theme` | `string` \| `null` | Theme file path as written in frontmatter, or `null`. Provenance only: its definitions are already applied (spec §07.8). |

### BreakpointRange

One threshold of the breakpoint cover. Ranges are half-open: this one runs from `minWidth` up to the next entry's `minWidth`.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `minWidth` | `number` | Lowest viewport width, in CSS px, inclusive, that selects `variant`. The first entry is always 0. |
| `variant` | [`VariantName`](#variantname) | Key into `variants`. The same name may appear twice when a named breakpoint splits `base` into two ranges. |

### FontFace

A registered font face (spec §07.1).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `family` | `string` | Family name exactly as styles refer to it. |
| `src` | `string` | Public URL of the font file, as the build emits it. |
| `weight` | [`WeightRange`](#weightrange) | Weight range the file covers. A static face has `min` equal to `max`; a variable face such as `300-700` has both ends (spec §07.1). |
| `italic` | `boolean` | True for an italic face. |

### Asset

A file the page loads, or data the build derived from one.

Type: [`ImageAsset`](#imageasset) \| [`VideoAsset`](#videoasset) \| [`LottieAsset`](#lottieasset) \| [`AudioAsset`](#audioasset) \| [`FileAsset`](#fileasset) \| [`PolygonAsset`](#polygonasset)

### Variants

The variants, keyed by name. `base` is always present, and so is every breakpoint named in `breakpoints`.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `base` | [`Variant`](#variant) | The variant for every width no named breakpoint covers (spec §07.4). |
| *any other key* | [`Variant`](#variant) |  |

### MusicCue

A `\music` cue (spec §10.6, 2026-10-09).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `at` | `object` \| `object` | Where it sits: before a story's block (it fires when that block's first line reaches `enterAt`), or at a scene's top. |
| `audio` | [`AssetId`](#assetid) \| `null` | The audio asset to play, or `null` to fade the music out. |
| `fadeMs` | `number` | Crossfade or fade-out length in milliseconds. |
| `volume` | `number` | Playback volume, 0 to 1. |
| `loop` | `boolean` | Repeat the track while it is current. |
| `enterAt` | `number` | How far up the viewport, from its bottom, the cue's position must come to fire, 0 to 1. |

### Diagnostic

A resolve or asset warning (spec §15.6).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `code` | `string` | Warning code, for example `"W031"`. |
| `category` | `"resolve-warning"` \| `"asset-warning"` | Which stage raised it (spec §15.6). |
| `message` | `string` | Human-readable message. |
| `file` | `string` | Source file the warning points at: the document or its theme. |
| `line` | `number` | 1-based source line. |
| `column` | `number` | 1-based source column. |
| `fix` | `string` \| `null` | Suggested fix, or `null` when there is none. |
| `variant` | [`VariantName`](#variantname) \| `null` | The variant the warning is about, or `null` when it holds at every breakpoint. |

### AssetId

Asset id. Opaque, stable within one build, unique in `assets`.

Type: `string`

### VariantName

Variant name: `"base"` or the name of a `\breakpoint` (spec §07.4).

Type: `string`

### WeightRange

An inclusive weight range.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `min` | `number` | Lowest weight the face covers. |
| `max` | `number` | Highest weight the face covers. |

### ImageAsset

An image and its generated responsive set (spec §11.4).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"image"` | Asset tag. |
| `width` | `number` | Intrinsic width of the source image in px. |
| `height` | `number` | Intrinsic height of the source image in px. |
| `animated` | `boolean` | True for an animated image such as a GIF (spec §11.4). |
| `sources` | [`ImageSource`](#imagesource)[] | Generated sources, preferred format first. |
| `fallback` | `string` | URL for the plain `<img src>`. |

### VideoAsset

A video file.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"video"` | Asset tag. |
| `width` | `number` | Intrinsic width in px. |
| `height` | `number` | Intrinsic height in px. |
| `sources` | [`MediaSource`](#mediasource)[] | Encodings, preferred first. |

### LottieAsset

A Lottie animation (spec §11.7).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"lottie"` | Asset tag. |
| `url` | `string` | Public URL of the `.json` or `.lottie` file. |
| `width` | `number` | Width in px, from the file. |
| `height` | `number` | Height in px, from the file. |

### AudioAsset

An audio file (spec §11.8).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"audio"` | Asset tag. |
| `sources` | [`MediaSource`](#mediasource)[] | Encodings, preferred first. |

### FileAsset

A file used as-is: a `.vtt` caption track or a transcript (spec §11.5, §11.8).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"file"` | Asset tag. |
| `url` | `string` | Public URL. |
| `type` | `string` | MIME type, for example `text/vtt`. |

### PolygonAsset

A polygon in normalized box coordinates, `[0, 0]` top-left to `[1, 1]` bottom-right. Layout scales it to the object's box and expands it by `wrap-offset` (spec §12.2).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"polygon"` | Asset tag. |
| `points` | `number`[][] | Vertices in order, at least three. |

### Variant

Everything layout and the renderer need for one breakpoint, fully valued.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `name` | [`VariantName`](#variantname) | This variant's key in `variants`. |
| `styles` | Record<string, [`ResolvedStyle`](#resolvedstyle)> | Every style key referenced anywhere in this variant, fully flattened. Contains exactly the referenced keys (spec §07.6). |
| `stories` | Record<string, [`Story`](#story)> | Every story, named and anonymous. A named story has the same block list, in the same order, in every variant. |
| `scenes` | [`Scene`](#scene)[] | Scenes in document order, parents already merged in (spec §08, §08.4). |
| `frames` | Record<string, [`Frame`](#frame)> | Every frame in the document, hidden ones included, keyed by id (spec §09.2). |
| `objects` | Record<string, [`ObjectElement`](#objectelement)> | Every object, grid-placed, anchored, background, grouped and gallery children, hidden ones included, keyed by id (spec §11). |
| `threads` | Record<string, [`FrameId`](#frameid)[]> | For each story shown in frames, its visible frames in thread order: scene order, then source order in the scene, hidden frames removed (spec §09.3). Stories laid out by an object, such as captions, are not listed. |

### StoryId

Story id: the `\story` name, or `<ownerId>#text` for an inline frame, pull quote or sidebar, `<ownerId>#caption` for a caption and credit, `folio#text` for the document's folio, `<parentName>#folio` for a parent's.

Type: `string`

### SceneId

Scene id: the scene's `name`, else `scene-1`, `scene-2`... in document order (spec §08.1). Also the scene's element id and URL fragment.

Type: `string`

### ImageSource

One format's set of widths.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `type` | `string` | MIME type, for example `image/avif`. |
| `srcset` | [`ImageCandidate`](#imagecandidate)[] | Candidates, narrowest first. |

### MediaSource

One encoding of a video or audio file.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `type` | `string` | MIME type. |
| `url` | `string` | Public URL. |

### ResolvedStyle

A fully flattened paragraph or run style (spec §07.6). Block keys are style names. Run keys are composed as `<blockKey>` then, in this order and only if present, `+strong`, `+em`, `+code`, `+link`, then `+span:<name>` per `\span` from outermost to innermost: `body+em+link`, `headline+span:smallcaps`.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `family` | `string`[] | Font family fallback list, most preferred first; generic families such as `serif` are allowed (spec §07.1, §07.6). |
| `weight` | `number` | Numeric font weight. |
| `italic` | `boolean` | Italic face. |
| `size` | [`Len`](#len) | Font size: `px` or `fluid` (spec §07.6). For a composed run style, already scaled against its block style. |
| `leading` | [`Len`](#len) | Line height. `bl` means baseline steps of the scene grid the line lands in (spec §07.6). |
| `tracking` | [`Len`](#len) | Letter spacing, `em` already multiplied out against `size` (spec §07.6). |
| `case` | `"none"` \| `"upper"` \| `"lower"` \| `"small-caps"` | Case transform applied to the text before measuring and rendering (spec §07.6). |
| `align` | `"left"` \| `"right"` \| `"center"` \| `"justify"` | Horizontal alignment within the slot (spec §07.6). `justify` spreads a line to the slot's full width by widening its spaces; the line that ends a paragraph is left alone. |
| `color` | [`Color`](#color) | Text color (spec §07.6). |
| `underline` | `boolean` | True when the text is underlined. Only the composed `+link` styles set it, from the default theme's link style (spec §16). |
| `indent` | [`Len`](#len) | First-line indent the style asks for. The indent actually applied to a paragraph is `ParagraphBlock.indent` (spec §07.6). |
| `spaceBefore` | [`Len`](#len) | Space above the block, suppressed at the top of a frame or column (spec §07.6). |
| `spaceAfter` | [`Len`](#len) | Space below the block (spec §07.6). |
| `hyphenate` | `boolean` | Whether the U+00AD soft hyphens in this style's text are honoured. When false, the consumer strips them before prepare (spec §07.6). |
| `widows` | `number` | Minimum lines of a paragraph at the top of a frame or column (spec §07.6). |
| `orphans` | `number` | Minimum lines of a paragraph at the bottom of a frame or column (spec §07.6). |
| `keepWithNext` | `boolean` | Keep this block in the same frame or column as the next block (spec §07.6). |
| `balance` | `boolean` | Break lines evenly: at the narrowest width that takes no more lines than the slot's (spec §07.6). |
| `hyphenMark` | `"end"` \| `"both"` | `both`: a hyphenated word also shows a hyphen where it continues, hanging before the next line (spec §07.6). |
| `composer` | `"line"` \| `"paragraph"` | `paragraph`: each line's break is chosen for the whole paragraph, evening the spacing and keeping a word from standing alone on the last line; `line`: each line takes as many words as fit (spec §07.6). |
| `hyphenateMin` | `number` | The shortest word, in letters, that hyphenates (spec §07.6). |
| `hyphenateCaps` | `boolean` | False: a word that starts with a capital never hyphenates (spec §07.6). |
| `hang` | `"none"` \| `"quotes"` \| `"punctuation"` | Quotation marks (`quotes`), and also hyphens, full stops and commas (`punctuation`), at a line's edge hang outside the column (spec §07.6). |
| `bindShort` | `boolean` | A short word (a, the, of, to...) never ends a line: it stays with the word after it (spec §07.6). |
| `justifyMin` | [`Len`](#len) \| `null` | With `align=justify`, a line in a slot narrower than this is set ragged right instead; `null`: every line justifies (spec §07.6). |
| `minSlot` | [`Len`](#len) \| `null` | The narrowest gap beside an object that text is set in; a narrower gap stays empty (spec §07.6, §09.6 step 3). `null`: 6em of the style's size, whatever size it ends with. |
| `mark` | `string` \| `null` | A pull quote's decorative mark, such as `“`, set above its text at three times the size, bold, in the accent; `null` for none (spec §07.6). |
| `features` | `string`[] | OpenType feature tags to enable, for example `["liga", "kern", "onum"]` (spec §07.6). |
| `snap` | `"baseline"` \| `"none"` | `baseline`: each line's baseline sits on the grid step. `none`: lines use their own leading and the block's height rounds up to whole baseline steps (spec §07.6). |
| `fit` | [`StyleFit`](#stylefit) \| `null` | `fit=width`: set each paragraph at the largest size, from `size` to `max` (three times `size` when `null`), that splits no word and, with `height`, stays no taller (spec §07.6). `null` for `fit=none`. |

### Story

A run of content with no position of its own (spec §09.1).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `id` | [`StoryId`](#storyid) | This story's key in `stories`. |
| `origin` | `"named"` \| `"frame"` \| `"pullquote"` \| `"sidebar"` \| `"caption"` \| `"folio"` | Where the story came from. `named` is a `\story`; the others are anonymous stories owned by `owner` (spec §09.2, §11.10). |
| `owner` | [`FrameId`](#frameid) \| [`ObjectId`](#objectid) \| `null` | The frame or object that owns an anonymous story, or `null` for a named story and the folio. |
| `overset` | `"grow"` \| `"clip"` \| `"error"` | What happens to text left over after the last frame of the thread is full (spec §09.5). Anonymous stories are always `grow`. |
| `blocks` | [`Block`](#block)[] | The content, in source order. A thread cursor addresses a block by its index here (spec §09.1). |

### Scene

A full-width band of the article (spec §08.1).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `id` | [`SceneId`](#sceneid) | Scene id (spec §08.1). |
| `parent` | `string` \| `null` | Name of the parent this scene was built from, or `null`. Provenance only: attributes and children are already merged (spec §08.4). |
| `grid` | [`Grid`](#grid) | The scene's grid at this breakpoint (spec §07.5). |
| `palette` | [`Palette`](#palette) | The scene's palette at this breakpoint, all five roles concrete (spec §07.3). |
| `height` | `"flow"` \| `"screen"` \| `"page"` | `flow`: as tall as its content plus `margin-y`. `screen`: one small-viewport height, divided into rows. `page`: at least one small-viewport height, taller when its content needs it; multi-column frames fill column bands (spec §08.2, §09.7). |
| `snap` | `"none"` \| `"soft"` \| `"hard"` | Scroll snapping on the scene's top edge. `hard` on a flow scene is already downgraded to `soft` (spec §08.3). |
| `turn` | [`SceneTurn`](#sceneturn) \| `null` | How the page arrives when the reader reaches it, or `null` for none (spec §08.3). |
| `bg` | [`Color`](#color) | Scene background color (spec §08.1). |
| `linearized` | `boolean` | True when this scene linearized at this breakpoint. Placements below are already rewritten: stacked in source order at full width, one internal column, wrap `jump` (spec §07.5). |
| `folio` | [`Folio`](#folio) \| `null` | The folio shown while this scene is under it: the scene's parent's folio if it declares one, else the document's; `null` when there is none or the scene sets `folio=hide` (spec §10.5). |
| `children` | [`ElementRef`](#elementref)[] | Top-level children in paint order: the parent's children first, beneath, then the scene's own, each in source order (spec §08.4, §11.3). Anchored objects are not listed here; they belong to their story. |

### Frame

A rectangle on a scene's grid that shows a slice of a story (spec §09.2).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `id` | [`FrameId`](#frameid) | Frame id, and the `frame` of every Positioned Line set in it. |
| `scene` | [`SceneId`](#sceneid) | Scene the frame belongs to. |
| `story` | [`StoryId`](#storyid) | The story shown. For an inline frame this is its anonymous story, `<id>#text` (spec §09.2). |
| `cols` | [`TrackRange`](#trackrange) | Columns spanned, with the grid's `body` default and linearize already applied. |
| `vertical` | [`Vertical`](#vertical) | Vertical placement (spec §09.2 `top`, `height`, `rows`). |
| `columns` | `number` \| `"auto"` | Number of internal columns (spec §09.2 `columns`). `auto` leaves the number to layout, which fits the columns to `measure` -- or, with no measure, to 32 times the text size -- so a wider screen gets more columns rather than longer lines. |
| `columnGap` | [`Len`](#len) | Space between internal columns (spec §09.2 `column-gap`). |
| `balance` | `boolean` | Balance internal columns when the frame has no definite height (spec §09.4). |
| `columnRule` | `"none"` \| `"rule"` | `rule`: a 1px line in the palette's `rule` colour mid-gap between columns that hold text, per band (spec §09.2). |
| `valign` | `"top"` \| `"center"` \| `"bottom"` | Vertical alignment of content that fits a definite height (spec §09.2). |
| `measure` | [`Len`](#len) \| `null` | Cap on every line's width, including lines beside a wrap; the capped slot stays left-aligned. `null` means no cap (spec §09.2 `measure`). |
| `inset` | [`Len`](#len) | Inner padding on every side (spec §09.2). |
| `bg` | [`Color`](#color) \| `null` | Background color, or `null` for none (spec §09.2). |
| `z` | `number` | Stacking order within the content layer, source order written in (spec §09.2). |
| `hidden` | `boolean` | True when hidden at this breakpoint. A hidden frame is absent from `threads` (spec §09.3). |
| `wrap` | `object` \| `null` | `wrap=rect` (spec §09.2): the frame's box, to its last line, cuts into the frames set after it, as an object's rectangle does, with `offset` below it (not at its sides, which are on grid lines). `null` for `wrap=none`. |
| `reveal` | [`Reveal`](#reveal) | The frame's reveal (spec §13). |

### ObjectElement

Any placed non-text item (spec §11).

Type: [`FigureObject`](#figureobject) \| [`VideoObject`](#videoobject) \| [`EmbedObject`](#embedobject) \| [`LottieObject`](#lottieobject) \| [`AudioObject`](#audioobject) \| [`GalleryObject`](#galleryobject) \| [`PullquoteObject`](#pullquoteobject) \| [`SidebarObject`](#sidebarobject) \| [`GroupObject`](#groupobject) \| [`RuleObject`](#ruleobject)

### FrameId

Frame id: author `name`, else `frame-<n>` in document order; `<sceneId>/<id>` for a frame instantiated from a parent; `<sceneId>/frame` for the default frame of a shorthand or implicit scene.

Type: `string`

### ImageCandidate

One generated width.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `url` | `string` | Public URL. |
| `width` | `number` | Width in px, the `w` descriptor. |

### Len

A length whose value needs at most the viewport or the frame's scene grid. `rem`, `em`, tokens, and `bl` inside grid definitions are already eliminated (spec §06.3).

Type: [`LenPx`](#lenpx) \| [`LenViewport`](#lenviewport) \| [`LenPct`](#lenpct) \| [`LenGrid`](#lengrid) \| [`LenFluid`](#lenfluid)

### Color

A color: a palette role, resolved against the palette of the scene the element is rendered in, or a fixed hex value (spec §07.3).

Type: [`ColorRole`](#colorrole) \| [`ColorHex`](#colorhex)

### StyleFit

Fitted text (spec §07.6).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `max` | [`Len`](#len) \| `null` | Largest size, or `null` for three times the style's size. |
| `height` | [`Len`](#len) \| `null` | Tallest the paragraph may be, or `null` for no limit. |

### ObjectId

Object id: author `name`, else `<command>-<n>` numbered per command in document order (`figure-2`); `<sceneId>/<id>` when instantiated from a parent. Groups, scene-level rules and gallery children are objects.

Type: `string`

### Block

One unit of story content. Anchored objects, frame breaks and in-frame rules are blocks, so every anchor falls between blocks.

Type: [`ParagraphBlock`](#paragraphblock) \| [`ObjectBlock`](#objectblock) \| [`FrameBreakBlock`](#framebreakblock) \| [`RuleBlock`](#ruleblock)

### Grid

A grid's inputs at one breakpoint. Layout computes geometry from these and the viewport width (spec §07.5).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `name` | `string` | The grid's name. Provenance only. |
| `cols` | `number` | Number of columns. |
| `gutter` | [`Len`](#len) | Space between columns. Never `bl`, `col` or `pct`. |
| `marginX` | [`Len`](#len) | Left and right outer margin. |
| `marginY` | [`Len`](#len) | Top and bottom scene padding; `bl` already converted to px. |
| `max` | [`Len`](#len) | Maximum width of the column area; beyond it the grid centers and the margins grow. |
| `baseline` | `number` | Baseline step in px: the `bl` unit for everything in this scene. |
| `rows` | `number` | Row count, used only by screen scenes (spec §08.2). |
| `rowGap` | [`Len`](#len) | Space between rows. |
| `body` | [`TrackRange`](#trackrange) | Columns of the default frame, with `all` resolved (spec §07.5 `body`). |
| `outdent` | [`Len`](#len) | How far an object on the grid's left or right outer edge reaches into the margin (spec §07.5 `outdent`). |

### Palette

The five palette roles as hex colors (spec §07.3).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `paper` | `string` | Scene background. |
| `ink` | `string` | Primary text. |
| `muted` | `string` | Captions, meta, credits. |
| `accent` | `string` | Kickers, links, drop caps, pull quote marks. |
| `rule` | `string` | Rules and borders. |

### SceneTurn

A page turn (spec §08.3): plays each time the scene enters the viewport after being fully out of it.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `effect` | `"fade"` \| `"slide"` | `fade`, or `slide`: 8% of the viewport height into place while fading, from the scroll direction. |
| `durationMs` | `number` | The scene's `duration`. |
| `ease` | `"standard"` \| `"in"` \| `"out"` \| `"linear"` | The scene's `ease`. |

### Folio

The persistent label fixed to the viewport (spec §10.5).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `story` | [`StoryId`](#storyid) | Its text as an anonymous story: `folio#text` for the document's folio, `<parentName>#folio` for a parent's. |
| `position` | `"top-left"` \| `"top-right"` \| `"bottom-left"` \| `"bottom-right"` \| `"margin-left"` \| `"margin-right"` | Viewport corner. |
| `progress` | `boolean` | Show a reading-progress indicator for the whole article. |

### ElementRef

A reference to a frame or an object (groups are objects).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"frame"` \| `"object"` | Which table the id is in. |
| `id` | `string` | Key into `frames` or `objects`. |

### TrackRange

A grid track range, 1-based and inclusive, with `end` and `all` already resolved to numbers (spec §06.2).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `from` | `number` | First track. |
| `to` | `number` | Last track, inclusive; at least `from`. |

### Vertical

Vertical placement on the grid. Which shape applies depends on the scene's height mode (spec §08.2).

Type: [`VerticalFlow`](#verticalflow) \| [`VerticalRows`](#verticalrows)

### Reveal

Reveal animation parameters, with any scene, parent or group stagger already baked into `delayMs` (spec §13).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `enter` | [`RevealKind`](#revealkind) | Animation as the element enters the viewport. |
| `exit` | [`RevealKind`](#revealkind) | Animation as the element leaves through the top of the viewport. |
| `enterAt` | `number` | Fraction of the element that must be inside the viewport before `enter` fires: 0.15 is `15%`. |
| `durationMs` | `number` | Duration in milliseconds. |
| `delayMs` | `number` | Delay in milliseconds, including this element's stagger step. |
| `ease` | `"standard"` \| `"in"` \| `"out"` \| `"linear"` | Easing curve. |
| `replay` | `boolean` | Replay `enter` every time the element comes back into view. |
| `motion` | `"reduce"` \| `"always"` | `reduce`: every reveal becomes `none` under reduced motion. `always`: this element keeps its motion (spec §13 rule 3). |

### FigureObject

`\figure`: an image, GIF included (spec §11.4).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"figure"` | Object kind, and the Positioned Object's `kind`. |
| `image` | [`AssetId`](#assetid) | Image asset for this breakpoint; `src@phone` selects a different one (spec §11.4). |
| `motionVideo` | [`AssetId`](#assetid) \| `null` | For an animated GIF the compiler transcoded, the looping muted video asset; otherwise `null` (spec §11.4). |
| `alt` | `string` \| `null` | Text alternative. `""` marks a decorative image; `null` means missing, which warned (spec §11.4). |
| `media` | [`MediaFit`](#mediafit) | Fit, focus, shape and clip. |
| `loading` | `"lazy"` \| `"eager"` | Fetch priority (spec §11.4). |
| `caption` | [`Caption`](#caption) \| `null` | Caption and credit, or `null`. |
| `id` | [`ObjectId`](#objectid) | Object id, and the `name` of its Positioned Object. |
| `placement` | [`Placement`](#placement) | How the object is positioned (spec §11.2, §11.3). |
| `layer` | `"background"` \| `"content"` \| `"overlay"` | Paint layer. Only `content` can exclude text (spec §11.2). |
| `z` | `number` | Stacking order within the layer, source order written in (spec §11.1). |
| `bleed` | `"none"` \| `"left"` \| `"right"` \| `"both"` | Sides on which the box extends through the margin to the viewport edge (spec §11.1). |
| `maxWidth` | [`Len`](#len) \| `null` | Cap on the box width, or `null` for none. The box keeps the centre of the space its placement gave it, so the room it gives back is shared by the text on both sides (spec §11.1). |
| `offsetX` | [`Len`](#len) | Horizontal fine adjustment of the box (spec §11.1). |
| `offsetY` | [`Len`](#len) | Vertical fine adjustment of the box (spec §11.1). |
| `wrap` | [`Wrap`](#wrap) | How text flows around the object. Always `none` off the content layer (spec §12). |
| `reveal` | [`Reveal`](#reveal) | The object's reveal (spec §13). |
| `hidden` | `boolean` | True when hidden at this breakpoint. An anchored hidden object is stepped over by layout (spec §09.3, §11.1). |

### VideoObject

`\video` (spec §11.5).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"video"` | Object kind. |
| `video` | [`AssetId`](#assetid) | Video asset. |
| `poster` | [`AssetId`](#assetid) \| `null` | Poster image asset, or `null` when missing (warned unless background) (spec §11.5). |
| `alt` | `string` \| `null` | Text description; `""` decorative, `null` missing (spec §11.5). |
| `captions` | [`AssetId`](#assetid) \| `null` | Caption track asset (`.vtt`), or `null`. |
| `play` | `"manual"` \| `"visible"` \| `"auto"` | `visible` plays only while in the viewport. Becomes `manual` under reduced motion at runtime (spec §11.5, §13). |
| `loop` | `boolean` | Loop playback. |
| `muted` | `boolean` | Start muted. |
| `controls` | `boolean` | Show controls; `false` by default on the background layer (spec §11.5). |
| `media` | [`MediaFit`](#mediafit) | Fit, focus, shape and clip. |
| `caption` | [`Caption`](#caption) \| `null` | Caption and credit, or `null`. |
| `id` | [`ObjectId`](#objectid) | Object id, and the `name` of its Positioned Object. |
| `placement` | [`Placement`](#placement) | How the object is positioned (spec §11.2, §11.3). |
| `layer` | `"background"` \| `"content"` \| `"overlay"` | Paint layer. Only `content` can exclude text (spec §11.2). |
| `z` | `number` | Stacking order within the layer, source order written in (spec §11.1). |
| `bleed` | `"none"` \| `"left"` \| `"right"` \| `"both"` | Sides on which the box extends through the margin to the viewport edge (spec §11.1). |
| `maxWidth` | [`Len`](#len) \| `null` | Cap on the box width, or `null` for none. The box keeps the centre of the space its placement gave it, so the room it gives back is shared by the text on both sides (spec §11.1). |
| `offsetX` | [`Len`](#len) | Horizontal fine adjustment of the box (spec §11.1). |
| `offsetY` | [`Len`](#len) | Vertical fine adjustment of the box (spec §11.1). |
| `wrap` | [`Wrap`](#wrap) | How text flows around the object. Always `none` off the content layer (spec §12). |
| `reveal` | [`Reveal`](#reveal) | The object's reveal (spec §13). |
| `hidden` | `boolean` | True when hidden at this breakpoint. An anchored hidden object is stepped over by layout (spec §09.3, §11.1). |

### EmbedObject

`\embed`: a third-party player, always rectangular (spec §11.6).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"embed"` | Object kind. |
| `source` | [`EmbedProvider`](#embedprovider) \| [`EmbedIframe`](#embediframe) | What to embed. |
| `title` | `string` \| `null` | Accessible name, or `null` when missing (warned) (spec §11.6). |
| `ratio` | [`Ratio`](#ratio) | Box aspect ratio (spec §11.6). |
| `poster` | [`PosterAsset`](#posterasset) \| [`PosterUrl`](#posterurl) \| `null` | Poster: an image asset, or the provider thumbnail URL the resolver chose (spec §11.6); `null` when the provider has no fixed thumbnail URL (Vimeo, iframes). |
| `facade` | `boolean` | Show the poster and load the iframe on interaction (spec §11.6). |
| `caption` | [`Caption`](#caption) \| `null` | Caption and credit, or `null`. |
| `id` | [`ObjectId`](#objectid) | Object id, and the `name` of its Positioned Object. |
| `placement` | [`Placement`](#placement) | How the object is positioned (spec §11.2, §11.3). |
| `layer` | `"background"` \| `"content"` \| `"overlay"` | Paint layer. Only `content` can exclude text (spec §11.2). |
| `z` | `number` | Stacking order within the layer, source order written in (spec §11.1). |
| `bleed` | `"none"` \| `"left"` \| `"right"` \| `"both"` | Sides on which the box extends through the margin to the viewport edge (spec §11.1). |
| `maxWidth` | [`Len`](#len) \| `null` | Cap on the box width, or `null` for none. The box keeps the centre of the space its placement gave it, so the room it gives back is shared by the text on both sides (spec §11.1). |
| `offsetX` | [`Len`](#len) | Horizontal fine adjustment of the box (spec §11.1). |
| `offsetY` | [`Len`](#len) | Vertical fine adjustment of the box (spec §11.1). |
| `wrap` | [`Wrap`](#wrap) | How text flows around the object. Always `none` off the content layer (spec §12). |
| `reveal` | [`Reveal`](#reveal) | The object's reveal (spec §13). |
| `hidden` | `boolean` | True when hidden at this breakpoint. An anchored hidden object is stepped over by layout (spec §09.3, §11.1). |

### LottieObject

`\lottie` (spec §11.7).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"lottie"` | Object kind. |
| `lottie` | [`AssetId`](#assetid) | Lottie asset. |
| `alt` | `string` \| `null` | Text alternative; `""` decorative, `null` missing. |
| `play` | `"manual"` \| `"visible"` \| `"auto"` | Playback trigger (spec §11.7). |
| `loop` | `boolean` | Loop playback. |
| `media` | [`MediaFit`](#mediafit) | Fit, focus, shape and clip. `ratio` comes from the file unless set. |
| `caption` | [`Caption`](#caption) \| `null` | Caption and credit, or `null`. |
| `id` | [`ObjectId`](#objectid) | Object id, and the `name` of its Positioned Object. |
| `placement` | [`Placement`](#placement) | How the object is positioned (spec §11.2, §11.3). |
| `layer` | `"background"` \| `"content"` \| `"overlay"` | Paint layer. Only `content` can exclude text (spec §11.2). |
| `z` | `number` | Stacking order within the layer, source order written in (spec §11.1). |
| `bleed` | `"none"` \| `"left"` \| `"right"` \| `"both"` | Sides on which the box extends through the margin to the viewport edge (spec §11.1). |
| `maxWidth` | [`Len`](#len) \| `null` | Cap on the box width, or `null` for none. The box keeps the centre of the space its placement gave it, so the room it gives back is shared by the text on both sides (spec §11.1). |
| `offsetX` | [`Len`](#len) | Horizontal fine adjustment of the box (spec §11.1). |
| `offsetY` | [`Len`](#len) | Vertical fine adjustment of the box (spec §11.1). |
| `wrap` | [`Wrap`](#wrap) | How text flows around the object. Always `none` off the content layer (spec §12). |
| `reveal` | [`Reveal`](#reveal) | The object's reveal (spec §13). |
| `hidden` | `boolean` | True when hidden at this breakpoint. An anchored hidden object is stepped over by layout (spec §09.3, §11.1). |

### AudioObject

`\audio`: always shows controls, never autoplays (spec §11.8).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"audio"` | Object kind. |
| `audio` | [`AssetId`](#assetid) | Audio asset. |
| `title` | `string` \| `null` | Accessible name, or `null` when missing (warned). |
| `captions` | [`AssetId`](#assetid) \| `null` | Caption track asset, or `null`. |
| `transcript` | [`AssetId`](#assetid) \| `null` | Transcript file asset, or `null`. |
| `caption` | [`Caption`](#caption) \| `null` | Caption and credit, always below, or `null`. |
| `id` | [`ObjectId`](#objectid) | Object id, and the `name` of its Positioned Object. |
| `placement` | [`Placement`](#placement) | How the object is positioned (spec §11.2, §11.3). |
| `layer` | `"background"` \| `"content"` \| `"overlay"` | Paint layer. Only `content` can exclude text (spec §11.2). |
| `z` | `number` | Stacking order within the layer, source order written in (spec §11.1). |
| `bleed` | `"none"` \| `"left"` \| `"right"` \| `"both"` | Sides on which the box extends through the margin to the viewport edge (spec §11.1). |
| `maxWidth` | [`Len`](#len) \| `null` | Cap on the box width, or `null` for none. The box keeps the centre of the space its placement gave it, so the room it gives back is shared by the text on both sides (spec §11.1). |
| `offsetX` | [`Len`](#len) | Horizontal fine adjustment of the box (spec §11.1). |
| `offsetY` | [`Len`](#len) | Vertical fine adjustment of the box (spec §11.1). |
| `wrap` | [`Wrap`](#wrap) | How text flows around the object. Always `none` off the content layer (spec §12). |
| `reveal` | [`Reveal`](#reveal) | The object's reveal (spec §13). |
| `hidden` | `boolean` | True when hidden at this breakpoint. An anchored hidden object is stepped over by layout (spec §09.3, §11.1). |

### GalleryObject

`\gallery`: a set of figures and videos laid out together (spec §11.9).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"gallery"` | Object kind. |
| `layout` | `"grid"` \| `"strip"` | `grid` rows or a horizontal swipe `strip`. |
| `perRow` | `number` | Items per row in `grid` layout (spec §11.9 `per-row`). |
| `gap` | [`Len`](#len) | Space between items. |
| `ratio` | [`Ratio`](#ratio) \| `null` | Ratio forced on every item, or `null` to keep each item's own (spec §11.9). |
| `items` | [`ObjectId`](#objectid)[] | Items in source order; each has `ContainedPlacement` pointing back here. |
| `caption` | [`Caption`](#caption) \| `null` | The gallery's own caption and credit, or `null`. |
| `id` | [`ObjectId`](#objectid) | Object id, and the `name` of its Positioned Object. |
| `placement` | [`Placement`](#placement) | How the object is positioned (spec §11.2, §11.3). |
| `layer` | `"background"` \| `"content"` \| `"overlay"` | Paint layer. Only `content` can exclude text (spec §11.2). |
| `z` | `number` | Stacking order within the layer, source order written in (spec §11.1). |
| `bleed` | `"none"` \| `"left"` \| `"right"` \| `"both"` | Sides on which the box extends through the margin to the viewport edge (spec §11.1). |
| `maxWidth` | [`Len`](#len) \| `null` | Cap on the box width, or `null` for none. The box keeps the centre of the space its placement gave it, so the room it gives back is shared by the text on both sides (spec §11.1). |
| `offsetX` | [`Len`](#len) | Horizontal fine adjustment of the box (spec §11.1). |
| `offsetY` | [`Len`](#len) | Vertical fine adjustment of the box (spec §11.1). |
| `wrap` | [`Wrap`](#wrap) | How text flows around the object. Always `none` off the content layer (spec §12). |
| `reveal` | [`Reveal`](#reveal) | The object's reveal (spec §13). |
| `hidden` | `boolean` | True when hidden at this breakpoint. An anchored hidden object is stepped over by layout (spec §09.3, §11.1). |

### PullquoteObject

`\pullquote`: a text-bearing object (spec §11.10).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"pullquote"` | Object kind. |
| `story` | [`StoryId`](#storyid) | Its text as an anonymous story, `<id>#text`, including any `\cite`. |
| `id` | [`ObjectId`](#objectid) | Object id, and the `name` of its Positioned Object. |
| `placement` | [`Placement`](#placement) | How the object is positioned (spec §11.2, §11.3). |
| `layer` | `"background"` \| `"content"` \| `"overlay"` | Paint layer. Only `content` can exclude text (spec §11.2). |
| `z` | `number` | Stacking order within the layer, source order written in (spec §11.1). |
| `bleed` | `"none"` \| `"left"` \| `"right"` \| `"both"` | Sides on which the box extends through the margin to the viewport edge (spec §11.1). |
| `maxWidth` | [`Len`](#len) \| `null` | Cap on the box width, or `null` for none. The box keeps the centre of the space its placement gave it, so the room it gives back is shared by the text on both sides (spec §11.1). |
| `offsetX` | [`Len`](#len) | Horizontal fine adjustment of the box (spec §11.1). |
| `offsetY` | [`Len`](#len) | Vertical fine adjustment of the box (spec §11.1). |
| `wrap` | [`Wrap`](#wrap) | How text flows around the object. Always `none` off the content layer (spec §12). |
| `reveal` | [`Reveal`](#reveal) | The object's reveal (spec §13). |
| `hidden` | `boolean` | True when hidden at this breakpoint. An anchored hidden object is stepped over by layout (spec §09.3, §11.1). |

### SidebarObject

`\sidebar`: a boxed aside whose text is its own story and does not thread (spec §11.10).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"sidebar"` | Object kind. |
| `story` | [`StoryId`](#storyid) | Its content as an anonymous story, `<id>#text`: title, paragraphs and anchored figures. |
| `bg` | [`Color`](#color) \| `null` | Box background, or `null`. |
| `inset` | [`Len`](#len) | Inner padding. |
| `border` | `"none"` \| `"rule"` | Border style: `rule` draws one in the palette's rule color. |
| `portrait` | `boolean` | Narrow the box, from its slot's width, until it is taller than wide (spec §11.10). |
| `id` | [`ObjectId`](#objectid) | Object id, and the `name` of its Positioned Object. |
| `placement` | [`Placement`](#placement) | How the object is positioned (spec §11.2, §11.3). |
| `layer` | `"background"` \| `"content"` \| `"overlay"` | Paint layer. Only `content` can exclude text (spec §11.2). |
| `z` | `number` | Stacking order within the layer, source order written in (spec §11.1). |
| `bleed` | `"none"` \| `"left"` \| `"right"` \| `"both"` | Sides on which the box extends through the margin to the viewport edge (spec §11.1). |
| `maxWidth` | [`Len`](#len) \| `null` | Cap on the box width, or `null` for none. The box keeps the centre of the space its placement gave it, so the room it gives back is shared by the text on both sides (spec §11.1). |
| `offsetX` | [`Len`](#len) | Horizontal fine adjustment of the box (spec §11.1). |
| `offsetY` | [`Len`](#len) | Vertical fine adjustment of the box (spec §11.1). |
| `wrap` | [`Wrap`](#wrap) | How text flows around the object. Always `none` off the content layer (spec §12). |
| `reveal` | [`Reveal`](#reveal) | The object's reveal (spec §13). |
| `hidden` | `boolean` | True when hidden at this breakpoint. An anchored hidden object is stepped over by layout (spec §09.3, §11.1). |

### GroupObject

`\group`: several objects or frames placed, wrapped, revealed and hidden as one unit (spec §11.11).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"group"` | Object kind. |
| `layout` | `"stack"` \| `"row"` | `stack`: children one below another at the group's width. `row`: children pack into rows of whole grid columns that wrap (spec §11.11, design 2026-09-26). |
| `gap` | [`Len`](#len) | In a stack, space between children; in a row group, space between rows. Items in a row are separated by the grid gutter. |
| `valign` | `"top"` \| `"center"` \| `"bottom"` \| `"stretch"` \| `"text"` | Row groups: how a child shorter than its row sits in it. `stretch` gives every child the row's height. |
| `children` | [`GroupChild`](#groupchild)[] | Children in source order, hidden ones included. Objects among them have `ContainedPlacement`; frames keep their own record in `frames`, and their `cols` and `vertical` are ignored. |
| `id` | [`ObjectId`](#objectid) | Object id, and the `name` of its Positioned Object. |
| `placement` | [`Placement`](#placement) | How the object is positioned (spec §11.2, §11.3). |
| `layer` | `"background"` \| `"content"` \| `"overlay"` | Paint layer. Only `content` can exclude text (spec §11.2). |
| `z` | `number` | Stacking order within the layer, source order written in (spec §11.1). |
| `bleed` | `"none"` \| `"left"` \| `"right"` \| `"both"` | Sides on which the box extends through the margin to the viewport edge (spec §11.1). |
| `maxWidth` | [`Len`](#len) \| `null` | Cap on the box width, or `null` for none. The box keeps the centre of the space its placement gave it, so the room it gives back is shared by the text on both sides (spec §11.1). |
| `offsetX` | [`Len`](#len) | Horizontal fine adjustment of the box (spec §11.1). |
| `offsetY` | [`Len`](#len) | Vertical fine adjustment of the box (spec §11.1). |
| `wrap` | [`Wrap`](#wrap) | How text flows around the object. Always `none` off the content layer (spec §12). |
| `reveal` | [`Reveal`](#reveal) | The object's reveal (spec §13). |
| `hidden` | `boolean` | True when hidden at this breakpoint. An anchored hidden object is stepped over by layout (spec §09.3, §11.1). |

### RuleObject

A `\rule` written directly in a scene, placed like an object (spec §10.4).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"rule"` | Object kind. |
| `rule` | [`RuleSpec`](#rulespec) | The rule itself. |
| `id` | [`ObjectId`](#objectid) | Object id, and the `name` of its Positioned Object. |
| `placement` | [`Placement`](#placement) | How the object is positioned (spec §11.2, §11.3). |
| `layer` | `"background"` \| `"content"` \| `"overlay"` | Paint layer. Only `content` can exclude text (spec §11.2). |
| `z` | `number` | Stacking order within the layer, source order written in (spec §11.1). |
| `bleed` | `"none"` \| `"left"` \| `"right"` \| `"both"` | Sides on which the box extends through the margin to the viewport edge (spec §11.1). |
| `maxWidth` | [`Len`](#len) \| `null` | Cap on the box width, or `null` for none. The box keeps the centre of the space its placement gave it, so the room it gives back is shared by the text on both sides (spec §11.1). |
| `offsetX` | [`Len`](#len) | Horizontal fine adjustment of the box (spec §11.1). |
| `offsetY` | [`Len`](#len) | Vertical fine adjustment of the box (spec §11.1). |
| `wrap` | [`Wrap`](#wrap) | How text flows around the object. Always `none` off the content layer (spec §12). |
| `reveal` | [`Reveal`](#reveal) | The object's reveal (spec §13). |
| `hidden` | `boolean` | True when hidden at this breakpoint. An anchored hidden object is stepped over by layout (spec §09.3, §11.1). |

### LenPx

Absolute CSS pixels.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `u` | `"px"` | Unit tag. |
| `n` | `number` | Pixels. |

### LenViewport

A fraction of the viewport: `vw` of its width, `vh` of the small viewport height (spec §06.3).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `u` | `"vw"` \| `"vh"` | Unit tag. |
| `n` | `number` | Percent of the viewport dimension: 40 means 40vw. |

### LenPct

A percentage of the reference box the field's own description names (spec §06.3).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `u` | `"pct"` | Unit tag. |
| `n` | `number` | Percent: 50 means half the reference box. |

### LenGrid

Grid-relative: `col` is n columns including the n-1 gutters between them, `bl` is n baseline steps, both of the grid of the scene where the element is laid out (spec §06.3).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `u` | `"col"` \| `"bl"` | Unit tag. |
| `n` | `number` | Number of columns or baseline steps. |

### LenFluid

Linear from `min` px at viewport width `from` to `max` px at `to`, clamped outside that range (spec §06.3).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `u` | `"fluid"` | Unit tag. |
| `min` | `number` | Pixels at or below viewport width `from`. |
| `max` | `number` | Pixels at or above viewport width `to`. |
| `from` | `number` | Viewport width in px where interpolation starts. |
| `to` | `number` | Viewport width in px where interpolation ends. |

### ColorRole

A palette role, left symbolic so a scene's palette restyles everything in it (spec §07.3).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `role` | `"paper"` \| `"ink"` \| `"muted"` \| `"accent"` \| `"rule"` | One of the five fixed roles. |

### ColorHex

A fixed color.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `hex` | `string` | Eight lowercase hex digits with a leading `#`, alpha last: `#e0563aff`. |

### ParagraphBlock

A paragraph of text: bare prose or a text element (spec §10.1, §10.3).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"paragraph"` | Block tag. |
| `element` | `"prose"` \| `"kicker"` \| `"headline"` \| `"deck"` \| `"byline"` \| `"meta"` \| `"lede"` \| `"subhead"` \| `"cite"` \| `"bio"` \| `"caption"` \| `"credit"` \| `"title"` | The source construct, which the renderer maps to an HTML element: `prose` is bare prose, the rest are the text commands of spec §10.3. |
| `level` | `1` \| `2` \| `null` | Heading level for `subhead` (1 or 2, rendered `h2`/`h3`); `null` for every other element (spec §10.3). |
| `quote` | `number` \| `null` | Consecutive blocks with the same number belong to one `\blockquote`, counted from 1 within the story; `null` outside a block quote (spec §10.3). |
| `style` | [`StyleKey`](#stylekey) | Block style key, and the value of `style` on every Positioned Line of this paragraph (spec §07.6, §15.3). |
| `span` | `"column"` \| `"all"` | `all` stretches the block across every internal column of a multi-column frame; `column` is the normal case (spec §10.3). |
| `indent` | [`Len`](#len) | First-line indent actually applied: the style's indent, or zero `px` where §07.6 says it is skipped (first paragraph of a story, after a non-paragraph block, under a drop cap). |
| `dropcap` | [`Dropcap`](#dropcap) \| `null` | The drop cap on this paragraph, or `null` (spec §10.4). |
| `runs` | [`Run`](#run)[] | The paragraph's content as a flat list of styled runs. When there is a drop cap, the runs start after the cap's graphemes. |
| `links` | [`Link`](#link)[] | Link targets. A text run's `link` indexes this list, so consecutive runs with the same index form one link (spec §10.2). |

### ObjectBlock

An anchored object's position in its story. Layout places the object when the flow reaches this block (spec §11.3).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"object"` | Block tag. |
| `object` | [`ObjectId`](#objectid) | The anchored object. Present in `objects` even when hidden; a hidden object is stepped over. |

### FrameBreakBlock

A `\framebreak` (spec §09.3).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"framebreak"` | Block tag. |
| `scope` | `"frame"` \| `"column"` | `frame` ends the frame and all its remaining columns; `column` ends only the current internal column (spec §09.3). |

### RuleBlock

A `\rule` inside a frame: a horizontal divider set as a block (spec §10.4).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"rule"` | Block tag. |
| `rule` | [`RuleSpec`](#rulespec) | The rule itself. |

### VerticalFlow

Vertical placement in a flow scene (spec §09.2 `top`, `height`).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `mode` | `"flow"` | Placement tag. |
| `top` | [`Len`](#len) \| `"auto"` | Offset from the top of the scene's content area, or `auto`: below the previous sibling in source order that overlaps its columns, separated by `row-gap` (spec §09.2). |
| `height` | [`Len`](#len) \| `"auto"` | Box height, or `auto`: from the content, or from `ratio` for media (spec §09.2, §11.1). |

### VerticalRows

Vertical placement in a screen scene: a range of the grid's rows (spec §08.2).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `mode` | `"rows"` | Placement tag. |
| `rows` | [`TrackRange`](#trackrange) | Rows occupied, with `all` resolved. |

### RevealKind

The reveal animations (spec §13).

Type: `"none"` \| `"fade"` \| `"rise"` \| `"drop"` \| `"slide-left"` \| `"slide-right"` \| `"zoom"` \| `"wipe"`

### MediaFit

How visual media fill their box (spec §11.4).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `ratio` | [`Ratio`](#ratio) | Box aspect ratio, `auto` already replaced by the media's own (spec §11.4). |
| `fit` | `"cover"` \| `"contain"` \| `"fill"` \| `"none"` | How the media fills the box. |
| `focus` | [`FocusPoint`](#focuspoint) | Focal point kept in view when `cover` crops. |
| `shape` | [`Shape`](#shape) | The object's outline (spec §12.2). `rect` when the command takes no `shape`. |
| `clip` | `boolean` | Clip the media to `shape` (spec §11.4). |

### Caption

An object's caption and credit (spec §11.1, §11.4).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `story` | [`StoryId`](#storyid) | Anonymous story holding the `\caption` and `\credit` paragraphs, `<ownerId>#caption`. |
| `side` | `"below"` \| `"above"` \| `"overlay"` | Where it sits. `overlay` takes no space in the box (spec §11.1). |

### Placement

Where an object's position comes from (spec §11.3).

Type: [`GridPlacement`](#gridplacement) \| [`AnchoredPlacement`](#anchoredplacement) \| [`BackgroundPlacement`](#backgroundplacement) \| [`ContainedPlacement`](#containedplacement)

### Wrap

How text flows around an object (spec §12.1).

Type: [`WrapNone`](#wrapnone) \| [`WrapJump`](#wrapjump) \| [`WrapShaped`](#wrapshaped)

### EmbedProvider

A video on a provider with a known player.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `provider` | `"youtube"` \| `"vimeo"` | Provider. |
| `id` | `string` | Provider video id. |

### EmbedIframe

Any other page, in an iframe.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `provider` | `"iframe"` | Provider tag. |
| `url` | `string` | Page URL. |

### Ratio

An aspect ratio, width to height. `auto` is already replaced by the media's intrinsic ratio (spec §06.2, §11.4).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `w` | `number` | Width term. |
| `h` | `number` | Height term. |

### PosterAsset

A poster the build produced as an image asset.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `asset` | [`AssetId`](#assetid) | Image asset id. |

### PosterUrl

A poster loaded from a URL, such as a provider thumbnail.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `url` | `string` | Image URL. |

### GroupChild

A child of a group, with how a row group sizes it. Layout rounds these to whole grid columns.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `width` | [`Len`](#len) \| `"fit"` \| `null` | Fixed width, rounded to the nearest whole column; `fit`, a text frame's widest line, in whole columns (2026-09-30); or `null` for a child that fills. |
| `minWidth` | [`Len`](#len) \| `null` | Narrowest the child may be, rounded up to whole columns; `null` means one column. |
| `maxWidth` | [`Len`](#len) \| `null` | Widest the child may grow, rounded down to whole columns; `null` means the group's width. |
| `kind` | `"frame"` \| `"object"` | Which table the id is in. |
| `id` | `string` | Key into `frames` or `objects`. |

### RuleSpec

A horizontal rule's appearance (spec §10.4).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `weight` | [`Len`](#len) | Line thickness. |
| `color` | [`Color`](#color) | Line color. |
| `width` | [`Len`](#len) | Length of the line; `pct` is of the column or box it sits in. |
| `align` | `"left"` \| `"center"` \| `"right"` | Where a rule shorter than its column sits. |

### StyleKey

Style key: an author or theme style name for a block style, or a composed key for a run style (see `ResolvedStyle`).

Type: `string`

### Dropcap

A drop cap: the inputs to measuring and placing it. Its width is measured during prepare and lives on the prepared paragraph, not here (spec §10.4).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `lines` | `number` | Baseline steps the cap spans (spec §10.4 `lines`). |
| `chars` | `number` | Graphemes taken, not counting an opening quotation mark (spec §10.4 `chars`). |
| `s` | [`StringIndex`](#stringindex) | The exact cap text, including any opening quotation mark, as a string index. The paragraph's runs do not repeat it. |
| `style` | [`StyleKey`](#stylekey) | Style key of the cap, normally `dropcap` (spec §10.4, §16). |
| `hang` | `boolean` | True when the cap's opening quotation mark hangs outside the column, so the letter lines up with the text (spec §10.4 `quote=hang`). |

### Run

A piece of paragraph content.

Type: [`TextRun`](#textrun) \| [`BreakRun`](#breakrun) \| [`EndmarkRun`](#endmarkrun)

### Link

A link target (spec §10.2).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `href` | `string` | The URL as written, relative paths resolved against the source file. |

### FocusPoint

A point inside a box, in fractions from the top-left: `x: 0.5, y: 0.7` is `"50% 70%"` (spec §11.4 `focus`).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `x` | `number` | 0 is the left edge, 1 the right. |
| `y` | `number` | 0 is the top edge, 1 the bottom. |

### Shape

An object's outline, used for contour wrap and for clipping (spec §12.2).

Type: [`ShapeRect`](#shaperect) \| [`ShapeInscribed`](#shapeinscribed) \| [`ShapePolygon`](#shapepolygon)

### GridPlacement

Grid-placed: written directly in a scene (spec §11.3).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `mode` | `"grid"` | Placement tag. |
| `scene` | [`SceneId`](#sceneid) | Scene the object belongs to. |
| `cols` | [`TrackRange`](#trackrange) | Columns spanned, linearize already applied. |
| `vertical` | [`Vertical`](#vertical) | Vertical placement. |

### AnchoredPlacement

Anchored: written in a story, so it travels with the text (spec §11.3).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `mode` | `"anchored"` | Placement tag. |
| `story` | [`StoryId`](#storyid) | The story holding the anchor. |
| `block` | `number` | Index of the anchor's `ObjectBlock` in that story's `blocks`. |
| `horizontal` | [`AnchorHorizontal`](#anchorhorizontal) | Horizontal position (spec §11.3 table). |
| `height` | [`Len`](#len) \| `"auto"` | Box height, or `auto` from ratio or content (spec §11.1). |

### BackgroundPlacement

`layer=background`: fills the whole scene behind everything; `cols`, `rows` and `top` do not apply (spec §11.2).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `mode` | `"background"` | Placement tag. |
| `scene` | [`SceneId`](#sceneid) | Scene the object fills. |

### ContainedPlacement

Inside a group or gallery, which positions its children itself; the child's own placement attributes are ignored (spec §11.9, §11.11).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `mode` | `"contained"` | Placement tag. |
| `container` | [`ObjectId`](#objectid) | The group or gallery. |
| `index` | `number` | Position among the container's children, from 0. |

### WrapNone

Text ignores the object and may overlap it.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `mode` | `"none"` | Wrap tag. |

### WrapJump

Text skips the object's full vertical extent.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `mode` | `"jump"` | Wrap tag. |
| `offset` | [`Len`](#len) | Standoff above and below the object (spec §12.1 `wrap-offset`). |

### WrapShaped

Text is cut by an exclusion: the box for `rect`, the object's `shape` for `contour` (spec §12.1, §12.2).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `mode` | `"rect"` \| `"contour"` | Wrap tag. `contour` with a `rect` shape behaves like `rect`. |
| `side` | `"both"` \| `"left"` \| `"right"` \| `"largest"` | Which side or sides of the object text may occupy; `both` sets text in two slots per band (spec §12.1). |
| `offset` | [`Len`](#len) | Standoff between the exclusion and the text (spec §12.1). |

### StringIndex

Index into the document's `strings`.

Type: `number`

### TextRun

Text in one style with one set of semantics.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"text"` | Run tag. |
| `s` | [`StringIndex`](#stringindex) | The text, as a string index. |
| `style` | [`StyleKey`](#stylekey) | Composed run style key: what the text engine measures with. |
| `marks` | `"strong"` \| `"em"` \| `"code"`[] | Semantic marks, outermost first, for `<strong>`, `<em>` and `<code>`. Independent of appearance (spec §10.2). |
| `link` | `number` \| `null` | Index into the paragraph's `links`, or `null` when the run is not in a link. |

### BreakRun

A forced line break, from `\br` (spec §10.2).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"break"` | Run tag. |

### EndmarkRun

The end-of-article sign, from `\endmark` (spec §10.4).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"endmark"` | Run tag. |
| `s` | [`StringIndex`](#stringindex) | The glyph, as a string index. |
| `style` | [`StyleKey`](#stylekey) | Composed style key `<paragraph style>+endmark`: the enclosing paragraph's style in the accent color. |

### ShapeRect

The box itself.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"rect"` | Shape tag. |

### ShapeInscribed

A circle or an ellipse inscribed in the box (spec §12.2).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"circle"` \| `"ellipse"` | Shape tag. |

### ShapePolygon

A polygon: from `poly(...)`, or traced from the alpha channel at build time with `fit`/`focus` crops applied first (spec §12.2).

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `kind` | `"polygon"` | Shape tag. |
| `polygon` | [`AssetId`](#assetid) | A `polygon` asset in normalized box coordinates. |
| `source` | `"poly"` \| `"alpha"` | Where the polygon came from. Provenance only. |

### AnchorHorizontal

Horizontal position of an anchored object (spec §11.3).

Type: [`AnchorFull`](#anchorfull) \| [`AnchorSide`](#anchorside) \| [`AnchorCols`](#anchorcols)

### AnchorFull

`side=full` (the default): the full width of the current frame column; text stops above and resumes below.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `mode` | `"full"` | Horizontal tag. |

### AnchorSide

`side=left` or `right` with a width: inside the current column, and text wraps beside it.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `mode` | `"side"` | Horizontal tag. |
| `side` | `"left"` \| `"right"` \| `"center"` | Which edge of the column the object sits against; `center`: centred in it, text on both sides (2026-10-09). |
| `width` | [`Len`](#len) | Object width; `pct` is of the column width. |

### AnchorCols

`cols=`: absolute grid columns of the scene the anchor lands in, whichever frame holds it. Text in any overlapping frame wraps.

| Field | Type | Meaning |
| :---- | :---- | :---- |
| `mode` | `"cols"` | Horizontal tag. |
| `cols` | [`TrackRange`](#trackrange) | Columns spanned. |

<!-- END GENERATED FIELD REFERENCE -->
