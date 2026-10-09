/**
 * The Resolved Document, format version 1.
 *
 * SOURCE OF TRUTH. `resolved-document.schema.json` and the field reference in
 * `resolved-document.schema.md` are generated from this file by
 * `npm run gen:resolved`; a test fails if either is stale. Every doc comment
 * here is copied into both, so every field's sentence lives in one place.
 */

// ===========================================================================
// Document
// ===========================================================================

/**
 * The resolver's entire output and the layout engine's entire input (spec §15.1, §15.3). Every value is concrete: no tokens, `extends`, `parent`, defaults, shorthand or viewport-dependent result remains.
 */
export type ResolvedDocument = {
  /** Always `"wmxdsl-resolved"`. Lets a consumer reject a file that is not a Resolved Document before reading further. */
  format: "wmxdsl-resolved";
  /** Format major version. Bumped on any change that removes a field, changes a field's type or meaning, or weakens a guarantee in the schema document. Adding a field does not bump it. */
  version: 1;
  /** Frontmatter metadata, with defaults written in (spec §04). */
  meta: Meta;
  /** Sorted, total cover of all viewport widths from 0 upward, each range naming the variant it selects (spec §07.4). The active variant is the last entry whose `minWidth` is at or below the viewport width. */
  breakpoints: BreakpointRange[];
  /** Every registered font face, from theme and document (spec §07.1). Layout waits for the faces its active scenes use. */
  fonts: FontFace[];
  /** All text of the document, once. Runs, drop caps and end marks refer to entries by index. Quotes are curled, dashes and ellipses substituted, and U+00AD soft hyphens inserted (spec §10.2, §15.4 point 4). */
  strings: string[];
  /** Media files, generated responsive sets, text tracks and traced polygons, keyed by asset id. Shared by all variants so art-directed and repeated media is stored once (spec §11.4-§11.9, §12.2). */
  assets: Record<AssetId, Asset>;
  /** One complete variant per breakpoint plus `base` (spec §06.4). Nothing in a variant falls back to another variant. */
  variants: Variants;
  /** Soundtrack cues in document order (spec §10.6). The playing track is the last cue above the reading position. Empty when the document has none. */
  music: MusicCue[];
  /** Resolve and asset warnings (errors fail the build and never reach here). Carried for tooling and for the runtime console; layout ignores them (spec §15.6). */
  diagnostics: Diagnostic[];
};

/** A `\music` cue (spec §10.6, 2026-10-09). */
export type MusicCue = {
  /** Where it sits: before a story's block (it fires when that block's first line reaches `enterAt`), or at a scene's top. */
  at: { story: StoryId; block: number } | { scene: SceneId };
  /** The audio asset to play, or `null` to fade the music out. */
  audio: AssetId | null;
  /** Crossfade or fade-out length in milliseconds. */
  fadeMs: number;
  /** Playback volume, 0 to 1. */
  volume: number;
  /** Repeat the track while it is current. */
  loop: boolean;
  /** How far up the viewport, from its bottom, the cue's position must come to fire, 0 to 1. */
  enterAt: number;
};

/** Variant name: `"base"` or the name of a `\breakpoint` (spec §07.4). */
export type VariantName = string;

/** The variants, keyed by name. `base` is always present, and so is every breakpoint named in `breakpoints`. */
export type Variants = {
  /** The variant for every width no named breakpoint covers (spec §07.4). */
  base: Variant;
  [name: string]: Variant;
};

/** Frontmatter, resolved (spec §04). Absent optional fields are written as `null` or `[]`, never omitted. */
export type Meta = {
  /** Language major version from frontmatter `wmxdsl`. Always 1 (spec §17). */
  wmxdsl: 1;
  /** Document title for `<title>` and social cards. Independent of `\headline` (spec §04). */
  title: string;
  /** BCP-47 language tag; `"en"` when the frontmatter sets none. Drives quote curling, hyphenation and the page's `lang` (spec §04, §10.2). */
  lang: string;
  /** Meta description, or `null` (spec §04). */
  description: string | null;
  /** Author names from frontmatter `author`, a single string becoming a one-element list; `[]` when absent. Metadata only; the visible byline is a `\byline` (spec §04). */
  authors: string[];
  /** ISO 8601 date string exactly as given, or `null` (spec §04). */
  date: string | null;
  /** Section label, or `null` (spec §04). */
  section: string | null;
  /** Social card image, as an image asset id, or `null` (spec §04). */
  socialImage: AssetId | null;
  /** Theme file path as written in frontmatter, or `null`. Provenance only: its definitions are already applied (spec §07.8). */
  theme: string | null;
};

/** One threshold of the breakpoint cover. Ranges are half-open: this one runs from `minWidth` up to the next entry's `minWidth`. */
export type BreakpointRange = {
  /**
   * Lowest viewport width, in CSS px, inclusive, that selects `variant`. The first entry is always 0.
   * @minimum 0
   */
  minWidth: number;
  /** Key into `variants`. The same name may appear twice when a named breakpoint splits `base` into two ranges. */
  variant: VariantName;
};

/** A registered font face (spec §07.1). */
export type FontFace = {
  /** Family name exactly as styles refer to it. */
  family: string;
  /** Public URL of the font file, as the build emits it. */
  src: string;
  /** Weight range the file covers. A static face has `min` equal to `max`; a variable face such as `300-700` has both ends (spec §07.1). */
  weight: WeightRange;
  /** True for an italic face. */
  italic: boolean;
};

/** An inclusive weight range. */
export type WeightRange = {
  /** Lowest weight the face covers. */
  min: number;
  /** Highest weight the face covers. */
  max: number;
};

/** A resolve or asset warning (spec §15.6). */
export type Diagnostic = {
  /** Warning code, for example `"W031"`. */
  code: string;
  /** Which stage raised it (spec §15.6). */
  category: "resolve-warning" | "asset-warning";
  /** Human-readable message. */
  message: string;
  /** Source file the warning points at: the document or its theme. */
  file: string;
  /** 1-based source line. */
  line: number;
  /** 1-based source column. */
  column: number;
  /** Suggested fix, or `null` when there is none. */
  fix: string | null;
  /** The variant the warning is about, or `null` when it holds at every breakpoint. */
  variant: VariantName | null;
};

// ===========================================================================
// Identity
// ===========================================================================

/** Scene id: the scene's `name`, else `scene-1`, `scene-2`... in document order (spec §08.1). Also the scene's element id and URL fragment. */
export type SceneId = string;
/** Frame id: author `name`, else `frame-<n>` in document order; `<sceneId>/<id>` for a frame instantiated from a parent; `<sceneId>/frame` for the default frame of a shorthand or implicit scene. */
export type FrameId = string;
/** Object id: author `name`, else `<command>-<n>` numbered per command in document order (`figure-2`); `<sceneId>/<id>` when instantiated from a parent. Groups, scene-level rules and gallery children are objects. */
export type ObjectId = string;
/** Story id: the `\story` name, or `<ownerId>#text` for an inline frame, pull quote or sidebar, `<ownerId>#caption` for a caption and credit, `folio#text` for the document's folio, `<parentName>#folio` for a parent's. */
export type StoryId = string;
/** Style key: an author or theme style name for a block style, or a composed key for a run style (see `ResolvedStyle`). */
export type StyleKey = string;
/** Asset id. Opaque, stable within one build, unique in `assets`. */
export type AssetId = string;
/** Index into the document's `strings`. */
export type StringIndex = number;

// ===========================================================================
// Values
// ===========================================================================

/**
 * A length whose value needs at most the viewport or the frame's scene grid. `rem`, `em`, tokens, and `bl` inside grid definitions are already eliminated (spec §06.3).
 */
export type Len = LenPx | LenViewport | LenPct | LenGrid | LenFluid;

/** Absolute CSS pixels. */
export type LenPx = {
  /** Unit tag. */
  u: "px";
  /** Pixels. */
  n: number;
};

/** A fraction of the viewport: `vw` of its width, `vh` of the small viewport height (spec §06.3). */
export type LenViewport = {
  /** Unit tag. */
  u: "vw" | "vh";
  /** Percent of the viewport dimension: 40 means 40vw. */
  n: number;
};

/** A percentage of the reference box the field's own description names (spec §06.3). */
export type LenPct = {
  /** Unit tag. */
  u: "pct";
  /** Percent: 50 means half the reference box. */
  n: number;
};

/**
 * Grid-relative: `col` is n columns including the n-1 gutters between them, `bl` is n baseline steps, both of the grid of the scene where the element is laid out (spec §06.3).
 */
export type LenGrid = {
  /** Unit tag. */
  u: "col" | "bl";
  /** Number of columns or baseline steps. */
  n: number;
};

/** Linear from `min` px at viewport width `from` to `max` px at `to`, clamped outside that range (spec §06.3). */
export type LenFluid = {
  /** Unit tag. */
  u: "fluid";
  /** Pixels at or below viewport width `from`. */
  min: number;
  /** Pixels at or above viewport width `to`. */
  max: number;
  /** Viewport width in px where interpolation starts. */
  from: number;
  /** Viewport width in px where interpolation ends. */
  to: number;
};

/** A grid track range, 1-based and inclusive, with `end` and `all` already resolved to numbers (spec §06.2). */
export type TrackRange = {
  /**
   * First track.
   * @minimum 1
   */
  from: number;
  /**
   * Last track, inclusive; at least `from`.
   * @minimum 1
   */
  to: number;
};

/** A color: a palette role, resolved against the palette of the scene the element is rendered in, or a fixed hex value (spec §07.3). */
export type Color = ColorRole | ColorHex;

/** A palette role, left symbolic so a scene's palette restyles everything in it (spec §07.3). */
export type ColorRole = {
  /** One of the five fixed roles. */
  role: "paper" | "ink" | "muted" | "accent" | "rule";
};

/** A fixed color. */
export type ColorHex = {
  /**
   * Eight lowercase hex digits with a leading `#`, alpha last: `#e0563aff`.
   * @pattern ^#[0-9a-f]{8}$
   */
  hex: string;
};

/** An aspect ratio, width to height. `auto` is already replaced by the media's intrinsic ratio (spec §06.2, §11.4). */
export type Ratio = {
  /** Width term. */
  w: number;
  /** Height term. */
  h: number;
};

/** A point inside a box, in fractions from the top-left: `x: 0.5, y: 0.7` is `"50% 70%"` (spec §11.4 `focus`). */
export type FocusPoint = {
  /** 0 is the left edge, 1 the right. */
  x: number;
  /** 0 is the top edge, 1 the bottom. */
  y: number;
};

// ===========================================================================
// Variant
// ===========================================================================

/** Everything layout and the renderer need for one breakpoint, fully valued. */
export type Variant = {
  /** This variant's key in `variants`. */
  name: VariantName;
  /** Every style key referenced anywhere in this variant, fully flattened. Contains exactly the referenced keys (spec §07.6). */
  styles: Record<StyleKey, ResolvedStyle>;
  /** Every story, named and anonymous. A named story has the same block list, in the same order, in every variant. */
  stories: Record<StoryId, Story>;
  /** Scenes in document order, parents already merged in (spec §08, §08.4). */
  scenes: Scene[];
  /** Every frame in the document, hidden ones included, keyed by id (spec §09.2). */
  frames: Record<FrameId, Frame>;
  /** Every object, grid-placed, anchored, background, grouped and gallery children, hidden ones included, keyed by id (spec §11). */
  objects: Record<ObjectId, ObjectElement>;
  /** For each story shown in frames, its visible frames in thread order: scene order, then source order in the scene, hidden frames removed (spec §09.3). Stories laid out by an object, such as captions, are not listed. */
  threads: Record<StoryId, FrameId[]>;
};

// ===========================================================================
// Styles
// ===========================================================================

/**
 * A fully flattened paragraph or run style (spec §07.6). Block keys are style names. Run keys are composed as `<blockKey>` then, in this order and only if present, `+strong`, `+em`, `+code`, `+link`, then `+span:<name>` per `\span` from outermost to innermost: `body+em+link`, `headline+span:smallcaps`.
 */
export type ResolvedStyle = {
  /** Font family fallback list, most preferred first; generic families such as `serif` are allowed (spec §07.1, §07.6). */
  family: string[];
  /** Numeric font weight. */
  weight: number;
  /** Italic face. */
  italic: boolean;
  /** Font size: `px` or `fluid` (spec §07.6). For a composed run style, already scaled against its block style. */
  size: Len;
  /** Line height. `bl` means baseline steps of the scene grid the line lands in (spec §07.6). */
  leading: Len;
  /** Letter spacing, `em` already multiplied out against `size` (spec §07.6). */
  tracking: Len;
  /** Case transform applied to the text before measuring and rendering (spec §07.6). */
  case: "none" | "upper" | "lower" | "small-caps";
  /**
   * Horizontal alignment within the slot (spec §07.6). `justify` spreads a line
   * to the slot's full width by widening its spaces; the line that ends a
   * paragraph is left alone.
   */
  align: "left" | "right" | "center" | "justify";
  /** Text color (spec §07.6). */
  color: Color;
  /** True when the text is underlined. Only the composed `+link` styles set it, from the default theme's link style (spec §16). */
  underline: boolean;
  /** First-line indent the style asks for. The indent actually applied to a paragraph is `ParagraphBlock.indent` (spec §07.6). */
  indent: Len;
  /** Space above the block, suppressed at the top of a frame or column (spec §07.6). */
  spaceBefore: Len;
  /** Space below the block (spec §07.6). */
  spaceAfter: Len;
  /** Whether the U+00AD soft hyphens in this style's text are honoured. When false, the consumer strips them before prepare (spec §07.6). */
  hyphenate: boolean;
  /** Minimum lines of a paragraph at the top of a frame or column (spec §07.6). */
  widows: number;
  /** Minimum lines of a paragraph at the bottom of a frame or column (spec §07.6). */
  orphans: number;
  /** Keep this block in the same frame or column as the next block (spec §07.6). */
  keepWithNext: boolean;
  /** Break lines evenly: at the narrowest width that takes no more lines than the slot's (spec §07.6). */
  balance: boolean;
  /** `both`: a hyphenated word also shows a hyphen where it continues, hanging before the next line (spec §07.6). */
  hyphenMark: "end" | "both";
  /** `paragraph`: each line's break is chosen for the whole paragraph, evening the spacing and keeping a word from standing alone on the last line; `line`: each line takes as many words as fit (spec §07.6). */
  composer: "line" | "paragraph";
  /** The shortest word, in letters, that hyphenates (spec §07.6). */
  hyphenateMin: number;
  /** False: a word that starts with a capital never hyphenates (spec §07.6). */
  hyphenateCaps: boolean;
  /** Quotation marks (`quotes`), and also hyphens, full stops and commas (`punctuation`), at a line's edge hang outside the column (spec §07.6). */
  hang: "none" | "quotes" | "punctuation";
  /** A short word (a, the, of, to...) never ends a line: it stays with the word after it (spec §07.6). */
  bindShort: boolean;
  /** With `align=justify`, a line in a slot narrower than this is set ragged right instead; `null`: every line justifies (spec §07.6). */
  justifyMin: Len | null;
  /** The narrowest gap beside an object that text is set in; a narrower gap stays empty (spec §07.6, §09.6 step 3). `null`: 6em of the style's size, whatever size it ends with. */
  minSlot: Len | null;
  /** A pull quote's decorative mark, such as `“`, set above its text at three times the size, bold, in the accent; `null` for none (spec §07.6). */
  mark: string | null;
  /** OpenType feature tags to enable, for example `["liga", "kern", "onum"]` (spec §07.6). */
  features: string[];
  /** `baseline`: each line's baseline sits on the grid step. `none`: lines use their own leading and the block's height rounds up to whole baseline steps (spec §07.6). */
  snap: "baseline" | "none";
  /** `fit=width`: set each paragraph at the largest size, from `size` to `max` (three times `size` when `null`), that splits no word and, with `height`, stays no taller (spec §07.6). `null` for `fit=none`. */
  fit: StyleFit | null;
};

/** Fitted text (spec §07.6). */
export type StyleFit = {
  /** Largest size, or `null` for three times the style's size. */
  max: Len | null;
  /** Tallest the paragraph may be, or `null` for no limit. */
  height: Len | null;
};

// ===========================================================================
// Stories and text
// ===========================================================================

/** A run of content with no position of its own (spec §09.1). */
export type Story = {
  /** This story's key in `stories`. */
  id: StoryId;
  /** Where the story came from. `named` is a `\story`; the others are anonymous stories owned by `owner` (spec §09.2, §11.10). */
  origin: "named" | "frame" | "pullquote" | "sidebar" | "caption" | "folio";
  /** The frame or object that owns an anonymous story, or `null` for a named story and the folio. */
  owner: FrameId | ObjectId | null;
  /** What happens to text left over after the last frame of the thread is full (spec §09.5). Anonymous stories are always `grow`. */
  overset: "grow" | "clip" | "error";
  /** The content, in source order. A thread cursor addresses a block by its index here (spec §09.1). */
  blocks: Block[];
};

/** One unit of story content. Anchored objects, frame breaks and in-frame rules are blocks, so every anchor falls between blocks. */
export type Block = ParagraphBlock | ObjectBlock | FrameBreakBlock | RuleBlock;

/** A paragraph of text: bare prose or a text element (spec §10.1, §10.3). */
export type ParagraphBlock = {
  /** Block tag. */
  kind: "paragraph";
  /** The source construct, which the renderer maps to an HTML element: `prose` is bare prose, the rest are the text commands of spec §10.3. */
  element:
    | "prose"
    | "kicker"
    | "headline"
    | "deck"
    | "byline"
    | "meta"
    | "lede"
    | "subhead"
    | "cite"
    | "bio"
    | "caption"
    | "credit"
    | "title";
  /** Heading level for `subhead` (1 or 2, rendered `h2`/`h3`); `null` for every other element (spec §10.3). */
  level: 1 | 2 | null;
  /** Consecutive blocks with the same number belong to one `\blockquote`, counted from 1 within the story; `null` outside a block quote (spec §10.3). */
  quote: number | null;
  /** Block style key, and the value of `style` on every Positioned Line of this paragraph (spec §07.6, §15.3). */
  style: StyleKey;
  /** `all` stretches the block across every internal column of a multi-column frame; `column` is the normal case (spec §10.3). */
  span: "column" | "all";
  /** First-line indent actually applied: the style's indent, or zero `px` where §07.6 says it is skipped (first paragraph of a story, after a non-paragraph block, under a drop cap). */
  indent: Len;
  /** The drop cap on this paragraph, or `null` (spec §10.4). */
  dropcap: Dropcap | null;
  /** The paragraph's content as a flat list of styled runs. When there is a drop cap, the runs start after the cap's graphemes. */
  runs: Run[];
  /** Link targets. A text run's `link` indexes this list, so consecutive runs with the same index form one link (spec §10.2). */
  links: Link[];
};

/** A link target (spec §10.2). */
export type Link = {
  /** The URL as written, relative paths resolved against the source file. */
  href: string;
};

/** A drop cap: the inputs to measuring and placing it. Its width is measured during prepare and lives on the prepared paragraph, not here (spec §10.4). */
export type Dropcap = {
  /** Baseline steps the cap spans (spec §10.4 `lines`). */
  lines: number;
  /** Graphemes taken, not counting an opening quotation mark (spec §10.4 `chars`). */
  chars: number;
  /** The exact cap text, including any opening quotation mark, as a string index. The paragraph's runs do not repeat it. */
  s: StringIndex;
  /** Style key of the cap, normally `dropcap` (spec §10.4, §16). */
  style: StyleKey;
  /** True when the cap's opening quotation mark hangs outside the column, so the letter lines up with the text (spec §10.4 `quote=hang`). */
  hang: boolean;
};

/** A piece of paragraph content. */
export type Run = TextRun | BreakRun | EndmarkRun;

/** Text in one style with one set of semantics. */
export type TextRun = {
  /** Run tag. */
  kind: "text";
  /** The text, as a string index. */
  s: StringIndex;
  /** Composed run style key: what the text engine measures with. */
  style: StyleKey;
  /** Semantic marks, outermost first, for `<strong>`, `<em>` and `<code>`. Independent of appearance (spec §10.2). */
  marks: ("strong" | "em" | "code")[];
  /** Index into the paragraph's `links`, or `null` when the run is not in a link. */
  link: number | null;
};

/** A forced line break, from `\br` (spec §10.2). */
export type BreakRun = {
  /** Run tag. */
  kind: "break";
};

/** The end-of-article sign, from `\endmark` (spec §10.4). */
export type EndmarkRun = {
  /** Run tag. */
  kind: "endmark";
  /** The glyph, as a string index. */
  s: StringIndex;
  /** Composed style key `<paragraph style>+endmark`: the enclosing paragraph's style in the accent color. */
  style: StyleKey;
};

/** An anchored object's position in its story. Layout places the object when the flow reaches this block (spec §11.3). */
export type ObjectBlock = {
  /** Block tag. */
  kind: "object";
  /** The anchored object. Present in `objects` even when hidden; a hidden object is stepped over. */
  object: ObjectId;
};

/** A `\framebreak` (spec §09.3). */
export type FrameBreakBlock = {
  /** Block tag. */
  kind: "framebreak";
  /** `frame` ends the frame and all its remaining columns; `column` ends only the current internal column (spec §09.3). */
  scope: "frame" | "column";
};

/** A `\rule` inside a frame: a horizontal divider set as a block (spec §10.4). */
export type RuleBlock = {
  /** Block tag. */
  kind: "rule";
  /** The rule itself. */
  rule: RuleSpec;
};

/** A horizontal rule's appearance (spec §10.4). */
export type RuleSpec = {
  /** Line thickness. */
  weight: Len;
  /** Line color. */
  color: Color;
  /** Length of the line; `pct` is of the column or box it sits in. */
  width: Len;
  /** Where a rule shorter than its column sits. */
  align: "left" | "center" | "right";
};

// ===========================================================================
// Scenes and grids (spec §07.5, §08)
// ===========================================================================

/** A full-width band of the article (spec §08.1). */
export type Scene = {
  /** Scene id (spec §08.1). */
  id: SceneId;
  /** Name of the parent this scene was built from, or `null`. Provenance only: attributes and children are already merged (spec §08.4). */
  parent: string | null;
  /** The scene's grid at this breakpoint (spec §07.5). */
  grid: Grid;
  /** The scene's palette at this breakpoint, all five roles concrete (spec §07.3). */
  palette: Palette;
  /** `flow`: as tall as its content plus `margin-y`. `screen`: one small-viewport height, divided into rows. `page`: at least one small-viewport height, taller when its content needs it; multi-column frames fill column bands (spec §08.2, §09.7). */
  height: "flow" | "screen" | "page";
  /** Scroll snapping on the scene's top edge. `hard` on a flow scene is already downgraded to `soft` (spec §08.3). */
  snap: "none" | "soft" | "hard";
  /** How the page arrives when the reader reaches it, or `null` for none (spec §08.3). */
  turn: SceneTurn | null;
  /** Scene background color (spec §08.1). */
  bg: Color;
  /** True when this scene linearized at this breakpoint. Placements below are already rewritten: stacked in source order at full width, one internal column, wrap `jump` (spec §07.5). */
  linearized: boolean;
  /** The folio shown while this scene is under it: the scene's parent's folio if it declares one, else the document's; `null` when there is none or the scene sets `folio=hide` (spec §10.5). */
  folio: Folio | null;
  /** Top-level children in paint order: the parent's children first, beneath, then the scene's own, each in source order (spec §08.4, §11.3). Anchored objects are not listed here; they belong to their story. */
  children: ElementRef[];
};

/** A page turn (spec §08.3): plays each time the scene enters the viewport after being fully out of it. */
export type SceneTurn = {
  /** `fade`, or `slide`: 8% of the viewport height into place while fading, from the scroll direction. */
  effect: "fade" | "slide";
  /** The scene's `duration`. */
  durationMs: number;
  /** The scene's `ease`. */
  ease: Reveal["ease"];
};

/** A reference to a frame or an object (groups are objects). */
export type ElementRef = {
  /** Which table the id is in. */
  kind: "frame" | "object";
  /** Key into `frames` or `objects`. */
  id: string;
};

/** A grid's inputs at one breakpoint. Layout computes geometry from these and the viewport width (spec §07.5). */
export type Grid = {
  /** The grid's name. Provenance only. */
  name: string;
  /** Number of columns. */
  cols: number;
  /** Space between columns. Never `bl`, `col` or `pct`. */
  gutter: Len;
  /** Left and right outer margin. */
  marginX: Len;
  /** Top and bottom scene padding; `bl` already converted to px. */
  marginY: Len;
  /** Maximum width of the column area; beyond it the grid centers and the margins grow. */
  max: Len;
  /** Baseline step in px: the `bl` unit for everything in this scene. */
  baseline: number;
  /** Row count, used only by screen scenes (spec §08.2). */
  rows: number;
  /** Space between rows. */
  rowGap: Len;
  /** Columns of the default frame, with `all` resolved (spec §07.5 `body`). */
  body: TrackRange;
  /** How far an object on the grid's left or right outer edge reaches into the margin (spec §07.5 `outdent`). */
  outdent: Len;
};

/** The five palette roles as hex colors (spec §07.3). */
export type Palette = {
  /**
   * Scene background.
   * @pattern ^#[0-9a-f]{8}$
   */
  paper: string;
  /**
   * Primary text.
   * @pattern ^#[0-9a-f]{8}$
   */
  ink: string;
  /**
   * Captions, meta, credits.
   * @pattern ^#[0-9a-f]{8}$
   */
  muted: string;
  /**
   * Kickers, links, drop caps, pull quote marks.
   * @pattern ^#[0-9a-f]{8}$
   */
  accent: string;
  /**
   * Rules and borders.
   * @pattern ^#[0-9a-f]{8}$
   */
  rule: string;
};

// ===========================================================================
// Placement
// ===========================================================================

/** Vertical placement on the grid. Which shape applies depends on the scene's height mode (spec §08.2). */
export type Vertical = VerticalFlow | VerticalRows;

/** Vertical placement in a flow scene (spec §09.2 `top`, `height`). */
export type VerticalFlow = {
  /** Placement tag. */
  mode: "flow";
  /** Offset from the top of the scene's content area, or `auto`: below the previous sibling in source order that overlaps its columns, separated by `row-gap` (spec §09.2). */
  top: Len | "auto";
  /** Box height, or `auto`: from the content, or from `ratio` for media (spec §09.2, §11.1). */
  height: Len | "auto";
};

/** Vertical placement in a screen scene: a range of the grid's rows (spec §08.2). */
export type VerticalRows = {
  /** Placement tag. */
  mode: "rows";
  /** Rows occupied, with `all` resolved. */
  rows: TrackRange;
};

/** Reveal animation parameters, with any scene, parent or group stagger already baked into `delayMs` (spec §13). */
export type Reveal = {
  /** Animation as the element enters the viewport. */
  enter: RevealKind;
  /** Animation as the element leaves through the top of the viewport. */
  exit: RevealKind;
  /**
   * Fraction of the element that must be inside the viewport before `enter` fires: 0.15 is `15%`.
   * @minimum 0
   * @maximum 1
   */
  enterAt: number;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Delay in milliseconds, including this element's stagger step. */
  delayMs: number;
  /** Easing curve. */
  ease: "standard" | "in" | "out" | "linear";
  /** Replay `enter` every time the element comes back into view. */
  replay: boolean;
  /** `reduce`: every reveal becomes `none` under reduced motion. `always`: this element keeps its motion (spec §13 rule 3). */
  motion: "reduce" | "always";
};

/** The reveal animations (spec §13). */
export type RevealKind = "none" | "fade" | "rise" | "drop" | "slide-left" | "slide-right" | "zoom" | "wipe";

// ===========================================================================
// Frames (spec §09.2)
// ===========================================================================

/** A rectangle on a scene's grid that shows a slice of a story (spec §09.2). */
export type Frame = {
  /** Frame id, and the `frame` of every Positioned Line set in it. */
  id: FrameId;
  /** Scene the frame belongs to. */
  scene: SceneId;
  /** The story shown. For an inline frame this is its anonymous story, `<id>#text` (spec §09.2). */
  story: StoryId;
  /** Columns spanned, with the grid's `body` default and linearize already applied. */
  cols: TrackRange;
  /** Vertical placement (spec §09.2 `top`, `height`, `rows`). */
  vertical: Vertical;
  /**
   * Number of internal columns (spec §09.2 `columns`). `auto` leaves the
   * number to layout, which fits the columns to `measure` -- or, with no
   * measure, to 32 times the text size -- so a wider screen gets more columns
   * rather than longer lines.
   */
  columns: number | "auto";
  /** Space between internal columns (spec §09.2 `column-gap`). */
  columnGap: Len;
  /** Balance internal columns when the frame has no definite height (spec §09.4). */
  balance: boolean;
  /** `rule`: a 1px line in the palette's `rule` colour mid-gap between columns that hold text, per band (spec §09.2). */
  columnRule: "none" | "rule";
  /** Vertical alignment of content that fits a definite height (spec §09.2). */
  valign: "top" | "center" | "bottom";
  /** Cap on every line's width, including lines beside a wrap; the capped slot stays left-aligned. `null` means no cap (spec §09.2 `measure`). */
  measure: Len | null;
  /** Inner padding on every side (spec §09.2). */
  inset: Len;
  /** Background color, or `null` for none (spec §09.2). */
  bg: Color | null;
  /** Stacking order within the content layer, source order written in (spec §09.2). */
  z: number;
  /** True when hidden at this breakpoint. A hidden frame is absent from `threads` (spec §09.3). */
  hidden: boolean;
  /**
   * `wrap=rect` (spec §09.2): the frame's box, to its last line, cuts into the frames set after it,
   * as an object's rectangle does, with `offset` below it (not at its sides, which are on grid lines). `null` for `wrap=none`.
   */
  wrap: { offset: Len } | null;
  /** The frame's reveal (spec §13). */
  reveal: Reveal;
};

// ===========================================================================
// Objects (spec §11, §12)
// ===========================================================================

/** Any placed non-text item (spec §11). */
export type ObjectElement =
  | FigureObject
  | VideoObject
  | EmbedObject
  | LottieObject
  | AudioObject
  | GalleryObject
  | PullquoteObject
  | SidebarObject
  | GroupObject
  | RuleObject;

/** Attributes every object carries (spec §11.1). */
export type ObjectCommon = {
  /** Object id, and the `name` of its Positioned Object. */
  id: ObjectId;
  /** How the object is positioned (spec §11.2, §11.3). */
  placement: Placement;
  /** Paint layer. Only `content` can exclude text (spec §11.2). */
  layer: "background" | "content" | "overlay";
  /** Stacking order within the layer, source order written in (spec §11.1). */
  z: number;
  /** Sides on which the box extends through the margin to the viewport edge (spec §11.1). */
  bleed: "none" | "left" | "right" | "both";
  /**
   * Cap on the box width, or `null` for none. The box keeps the centre of the
   * space its placement gave it, so the room it gives back is shared by the
   * text on both sides (spec §11.1).
   */
  maxWidth: Len | null;
  /** Horizontal fine adjustment of the box (spec §11.1). */
  offsetX: Len;
  /** Vertical fine adjustment of the box (spec §11.1). */
  offsetY: Len;
  /** How text flows around the object. Always `none` off the content layer (spec §12). */
  wrap: Wrap;
  /** The object's reveal (spec §13). */
  reveal: Reveal;
  /** True when hidden at this breakpoint. An anchored hidden object is stepped over by layout (spec §09.3, §11.1). */
  hidden: boolean;
};

/** Where an object's position comes from (spec §11.3). */
export type Placement = GridPlacement | AnchoredPlacement | BackgroundPlacement | ContainedPlacement;

/** Grid-placed: written directly in a scene (spec §11.3). */
export type GridPlacement = {
  /** Placement tag. */
  mode: "grid";
  /** Scene the object belongs to. */
  scene: SceneId;
  /** Columns spanned, linearize already applied. */
  cols: TrackRange;
  /** Vertical placement. */
  vertical: Vertical;
};

/** Anchored: written in a story, so it travels with the text (spec §11.3). */
export type AnchoredPlacement = {
  /** Placement tag. */
  mode: "anchored";
  /** The story holding the anchor. */
  story: StoryId;
  /** Index of the anchor's `ObjectBlock` in that story's `blocks`. */
  block: number;
  /** Horizontal position (spec §11.3 table). */
  horizontal: AnchorHorizontal;
  /** Box height, or `auto` from ratio or content (spec §11.1). */
  height: Len | "auto";
};

/** Horizontal position of an anchored object (spec §11.3). */
export type AnchorHorizontal = AnchorFull | AnchorSide | AnchorCols;

/** `side=full` (the default): the full width of the current frame column; text stops above and resumes below. */
export type AnchorFull = {
  /** Horizontal tag. */
  mode: "full";
};

/** `side=left` or `right` with a width: inside the current column, and text wraps beside it. */
export type AnchorSide = {
  /** Horizontal tag. */
  mode: "side";
  /** Which edge of the column the object sits against; `center`: centred in it, text on both sides (2026-10-09). */
  side: "left" | "right" | "center";
  /** Object width; `pct` is of the column width. */
  width: Len;
};

/** `cols=`: absolute grid columns of the scene the anchor lands in, whichever frame holds it. Text in any overlapping frame wraps. */
export type AnchorCols = {
  /** Horizontal tag. */
  mode: "cols";
  /** Columns spanned. */
  cols: TrackRange;
};

/** `layer=background`: fills the whole scene behind everything; `cols`, `rows` and `top` do not apply (spec §11.2). */
export type BackgroundPlacement = {
  /** Placement tag. */
  mode: "background";
  /** Scene the object fills. */
  scene: SceneId;
};

/** Inside a group or gallery, which positions its children itself; the child's own placement attributes are ignored (spec §11.9, §11.11). */
export type ContainedPlacement = {
  /** Placement tag. */
  mode: "contained";
  /** The group or gallery. */
  container: ObjectId;
  /** Position among the container's children, from 0. */
  index: number;
};

/** How text flows around an object (spec §12.1). */
export type Wrap = WrapNone | WrapJump | WrapShaped;

/** Text ignores the object and may overlap it. */
export type WrapNone = {
  /** Wrap tag. */
  mode: "none";
};

/** Text skips the object's full vertical extent. */
export type WrapJump = {
  /** Wrap tag. */
  mode: "jump";
  /** Standoff above and below the object (spec §12.1 `wrap-offset`). */
  offset: Len;
};

/** Text is cut by an exclusion: the box for `rect`, the object's `shape` for `contour` (spec §12.1, §12.2). */
export type WrapShaped = {
  /** Wrap tag. `contour` with a `rect` shape behaves like `rect`. */
  mode: "rect" | "contour";
  /** Which side or sides of the object text may occupy; `both` sets text in two slots per band (spec §12.1). */
  side: "both" | "left" | "right" | "largest";
  /** Standoff between the exclusion and the text (spec §12.1). */
  offset: Len;
};

/** An object's outline, used for contour wrap and for clipping (spec §12.2). */
export type Shape = ShapeRect | ShapeInscribed | ShapePolygon;

/** The box itself. */
export type ShapeRect = {
  /** Shape tag. */
  kind: "rect";
};

/** A circle or an ellipse inscribed in the box (spec §12.2). */
export type ShapeInscribed = {
  /** Shape tag. */
  kind: "circle" | "ellipse";
};

/** A polygon: from `poly(...)`, or traced from the alpha channel at build time with `fit`/`focus` crops applied first (spec §12.2). */
export type ShapePolygon = {
  /** Shape tag. */
  kind: "polygon";
  /** A `polygon` asset in normalized box coordinates. */
  polygon: AssetId;
  /** Where the polygon came from. Provenance only. */
  source: "poly" | "alpha";
};

/** An object's caption and credit (spec §11.1, §11.4). */
export type Caption = {
  /** Anonymous story holding the `\caption` and `\credit` paragraphs, `<ownerId>#caption`. */
  story: StoryId;
  /** Where it sits. `overlay` takes no space in the box (spec §11.1). */
  side: "below" | "above" | "overlay";
};

/** How visual media fill their box (spec §11.4). */
export type MediaFit = {
  /** Box aspect ratio, `auto` already replaced by the media's own (spec §11.4). */
  ratio: Ratio;
  /** How the media fills the box. */
  fit: "cover" | "contain" | "fill" | "none";
  /** Focal point kept in view when `cover` crops. */
  focus: FocusPoint;
  /** The object's outline (spec §12.2). `rect` when the command takes no `shape`. */
  shape: Shape;
  /** Clip the media to `shape` (spec §11.4). */
  clip: boolean;
};

/** `\figure`: an image, GIF included (spec §11.4). */
export type FigureObject = ObjectCommon & {
  /** Object kind, and the Positioned Object's `kind`. */
  kind: "figure";
  /** Image asset for this breakpoint; `src@phone` selects a different one (spec §11.4). */
  image: AssetId;
  /** For an animated GIF the compiler transcoded, the looping muted video asset; otherwise `null` (spec §11.4). */
  motionVideo: AssetId | null;
  /** Text alternative. `""` marks a decorative image; `null` means missing, which warned (spec §11.4). */
  alt: string | null;
  /** Fit, focus, shape and clip. */
  media: MediaFit;
  /** Fetch priority (spec §11.4). */
  loading: "lazy" | "eager";
  /** Caption and credit, or `null`. */
  caption: Caption | null;
};

/** `\video` (spec §11.5). */
export type VideoObject = ObjectCommon & {
  /** Object kind. */
  kind: "video";
  /** Video asset. */
  video: AssetId;
  /** Poster image asset, or `null` when missing (warned unless background) (spec §11.5). */
  poster: AssetId | null;
  /** Text description; `""` decorative, `null` missing (spec §11.5). */
  alt: string | null;
  /** Caption track asset (`.vtt`), or `null`. */
  captions: AssetId | null;
  /** `visible` plays only while in the viewport. Becomes `manual` under reduced motion at runtime (spec §11.5, §13). */
  play: "manual" | "visible" | "auto";
  /** Loop playback. */
  loop: boolean;
  /** Start muted. */
  muted: boolean;
  /** Show controls; `false` by default on the background layer (spec §11.5). */
  controls: boolean;
  /** Fit, focus, shape and clip. */
  media: MediaFit;
  /** Caption and credit, or `null`. */
  caption: Caption | null;
};

/** `\embed`: a third-party player, always rectangular (spec §11.6). */
export type EmbedObject = ObjectCommon & {
  /** Object kind. */
  kind: "embed";
  /** What to embed. */
  source: EmbedProvider | EmbedIframe;
  /** Accessible name, or `null` when missing (warned) (spec §11.6). */
  title: string | null;
  /** Box aspect ratio (spec §11.6). */
  ratio: Ratio;
  /** Poster: an image asset, or the provider thumbnail URL the resolver chose (spec §11.6); `null` when the provider has no fixed thumbnail URL (Vimeo, iframes). */
  poster: PosterAsset | PosterUrl | null;
  /** Show the poster and load the iframe on interaction (spec §11.6). */
  facade: boolean;
  /** Caption and credit, or `null`. */
  caption: Caption | null;
};

/** A video on a provider with a known player. */
export type EmbedProvider = {
  /** Provider. */
  provider: "youtube" | "vimeo";
  /** Provider video id. */
  id: string;
};

/** Any other page, in an iframe. */
export type EmbedIframe = {
  /** Provider tag. */
  provider: "iframe";
  /** Page URL. */
  url: string;
};

/** A poster the build produced as an image asset. */
export type PosterAsset = {
  /** Image asset id. */
  asset: AssetId;
};

/** A poster loaded from a URL, such as a provider thumbnail. */
export type PosterUrl = {
  /** Image URL. */
  url: string;
};

/** `\lottie` (spec §11.7). */
export type LottieObject = ObjectCommon & {
  /** Object kind. */
  kind: "lottie";
  /** Lottie asset. */
  lottie: AssetId;
  /** Text alternative; `""` decorative, `null` missing. */
  alt: string | null;
  /** Playback trigger (spec §11.7). */
  play: "manual" | "visible" | "auto";
  /** Loop playback. */
  loop: boolean;
  /** Fit, focus, shape and clip. `ratio` comes from the file unless set. */
  media: MediaFit;
  /** Caption and credit, or `null`. */
  caption: Caption | null;
};

/** `\audio`: always shows controls, never autoplays (spec §11.8). */
export type AudioObject = ObjectCommon & {
  /** Object kind. */
  kind: "audio";
  /** Audio asset. */
  audio: AssetId;
  /** Accessible name, or `null` when missing (warned). */
  title: string | null;
  /** Caption track asset, or `null`. */
  captions: AssetId | null;
  /** Transcript file asset, or `null`. */
  transcript: AssetId | null;
  /** Caption and credit, always below, or `null`. */
  caption: Caption | null;
};

/** `\gallery`: a set of figures and videos laid out together (spec §11.9). */
export type GalleryObject = ObjectCommon & {
  /** Object kind. */
  kind: "gallery";
  /** `grid` rows or a horizontal swipe `strip`. */
  layout: "grid" | "strip";
  /** Items per row in `grid` layout (spec §11.9 `per-row`). */
  perRow: number;
  /** Space between items. */
  gap: Len;
  /** Ratio forced on every item, or `null` to keep each item's own (spec §11.9). */
  ratio: Ratio | null;
  /** Items in source order; each has `ContainedPlacement` pointing back here. */
  items: ObjectId[];
  /** The gallery's own caption and credit, or `null`. */
  caption: Caption | null;
};

/** `\pullquote`: a text-bearing object (spec §11.10). */
export type PullquoteObject = ObjectCommon & {
  /** Object kind. */
  kind: "pullquote";
  /** Its text as an anonymous story, `<id>#text`, including any `\cite`. */
  story: StoryId;
};

/** `\sidebar`: a boxed aside whose text is its own story and does not thread (spec §11.10). */
export type SidebarObject = ObjectCommon & {
  /** Object kind. */
  kind: "sidebar";
  /** Its content as an anonymous story, `<id>#text`: title, paragraphs and anchored figures. */
  story: StoryId;
  /** Box background, or `null`. */
  bg: Color | null;
  /** Inner padding. */
  inset: Len;
  /** Border style: `rule` draws one in the palette's rule color. */
  border: "none" | "rule";
  /** Narrow the box, from its slot's width, until it is taller than wide (spec §11.10). */
  portrait: boolean;
};

/** `\group`: several objects or frames placed, wrapped, revealed and hidden as one unit (spec §11.11). */
export type GroupObject = ObjectCommon & {
  /** Object kind. */
  kind: "group";
  /** `stack`: children one below another at the group's width. `row`: children pack into rows of whole grid columns that wrap (spec §11.11, design 2026-09-26). */
  layout: "stack" | "row";
  /** In a stack, space between children; in a row group, space between rows. Items in a row are separated by the grid gutter. */
  gap: Len;
  /** Row groups: how a child shorter than its row sits in it. `stretch` gives every child the row's height. */
  valign: "top" | "center" | "bottom" | "stretch" | "text";
  /** Children in source order, hidden ones included. Objects among them have `ContainedPlacement`; frames keep their own record in `frames`, and their `cols` and `vertical` are ignored. */
  children: GroupChild[];
};

/** A child of a group, with how a row group sizes it. Layout rounds these to whole grid columns. */
export type GroupChild = ElementRef & {
  /** Fixed width, rounded to the nearest whole column; `fit`, a text frame's widest line, in whole columns (2026-09-30); or `null` for a child that fills. */
  width: Len | "fit" | null;
  /** Narrowest the child may be, rounded up to whole columns; `null` means one column. */
  minWidth: Len | null;
  /** Widest the child may grow, rounded down to whole columns; `null` means the group's width. */
  maxWidth: Len | null;
};

/** A `\rule` written directly in a scene, placed like an object (spec §10.4). */
export type RuleObject = ObjectCommon & {
  /** Object kind. */
  kind: "rule";
  /** The rule itself. */
  rule: RuleSpec;
};

// ===========================================================================
// Folio (spec §10.5)
// ===========================================================================

/** The persistent label fixed to the viewport (spec §10.5). */
export type Folio = {
  /** Its text as an anonymous story: `folio#text` for the document's folio, `<parentName>#folio` for a parent's. */
  story: StoryId;
  /** Viewport corner. */
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "margin-left" | "margin-right";
  /** Show a reading-progress indicator for the whole article. */
  progress: boolean;
};

// ===========================================================================
// Assets
// ===========================================================================

/** A file the page loads, or data the build derived from one. */
export type Asset = ImageAsset | VideoAsset | LottieAsset | AudioAsset | FileAsset | PolygonAsset;

/** An image and its generated responsive set (spec §11.4). */
export type ImageAsset = {
  /** Asset tag. */
  kind: "image";
  /** Intrinsic width of the source image in px. */
  width: number;
  /** Intrinsic height of the source image in px. */
  height: number;
  /** True for an animated image such as a GIF (spec §11.4). */
  animated: boolean;
  /** Generated sources, preferred format first. */
  sources: ImageSource[];
  /** URL for the plain `<img src>`. */
  fallback: string;
};

/** One format's set of widths. */
export type ImageSource = {
  /** MIME type, for example `image/avif`. */
  type: string;
  /** Candidates, narrowest first. */
  srcset: ImageCandidate[];
};

/** One generated width. */
export type ImageCandidate = {
  /** Public URL. */
  url: string;
  /** Width in px, the `w` descriptor. */
  width: number;
};

/** A video file. */
export type VideoAsset = {
  /** Asset tag. */
  kind: "video";
  /** Intrinsic width in px. */
  width: number;
  /** Intrinsic height in px. */
  height: number;
  /** Encodings, preferred first. */
  sources: MediaSource[];
};

/** An audio file (spec §11.8). */
export type AudioAsset = {
  /** Asset tag. */
  kind: "audio";
  /** Encodings, preferred first. */
  sources: MediaSource[];
};

/** One encoding of a video or audio file. */
export type MediaSource = {
  /** MIME type. */
  type: string;
  /** Public URL. */
  url: string;
};

/** A Lottie animation (spec §11.7). */
export type LottieAsset = {
  /** Asset tag. */
  kind: "lottie";
  /** Public URL of the `.json` or `.lottie` file. */
  url: string;
  /** Width in px, from the file. */
  width: number;
  /** Height in px, from the file. */
  height: number;
};

/** A file used as-is: a `.vtt` caption track or a transcript (spec §11.5, §11.8). */
export type FileAsset = {
  /** Asset tag. */
  kind: "file";
  /** Public URL. */
  url: string;
  /** MIME type, for example `text/vtt`. */
  type: string;
};

/** A polygon in normalized box coordinates, `[0, 0]` top-left to `[1, 1]` bottom-right. Layout scales it to the object's box and expands it by `wrap-offset` (spec §12.2). */
export type PolygonAsset = {
  /** Asset tag. */
  kind: "polygon";
  /**
   * Vertices in order, at least three.
   * @minItems 3
   */
  points: [number, number][];
};
