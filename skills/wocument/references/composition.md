# Composition: how the engine sets a page

Section numbers (§) are `wocument-specification.md`'s. Numbers are Vanilla's (`themes.md`).

## The page model

An article is **scenes** stacked top to bottom. Each scene is a full-width band with its own
grid, palette and height; changing scene is the screen's page turn.

| `height=` | The scene is | Placement inside it | Use it for |
| :---- | :---- | :---- | :---- |
| `flow` (default) | as tall as its content | `cols=` and `top=` (or automatic top) | essays read as one column, closing notes, a run of mixed elements |
| `screen` | exactly one viewport | `cols=` and `rows=` (the grid's `rows`, 6 by default) | openers, interludes, a picture with a line of text |
| `page` | at least one viewport, taller when needed | as flow; a multi-column frame sets its text in **column bands**, one screen each | the magazine page: columns, floating pictures, a heading block |

**The implicit form** (no `\scene`): one `page` scene on the default grid. A leading run of
`\kicker` `\headline` `\deck` `\byline` `\meta` goes in a heading frame `cols=1-8` (all columns
on tablet and phone); the rest goes in a story frame across all columns, as many columns as keep
each line within 600px (two on a laptop, three on a large desktop, four on wide screens, one on
tablets and phones), in column bands. This is a strong default: use it for a feature unless the
design needs more than one scene.

## The grid

`\grid[name=..., cols, gutter, margin-x, margin-y, max, baseline, rows, row-gap, body, outdent]`,
redefined per breakpoint with `at=`. Columns: `C = min(W - 2*margin-x, max)` wide, centred.

- Vanilla's `default`: 12 columns (8 tablet, 4 phone), a baseline step of one body line (33px
  on large screens, 28px on laptops and phones), `body=4-9` (2-7 on tablet, all on phone).
- **Every body line sits on the baseline grid**, so neighbouring columns share baselines. Give
  vertical lengths in `bl` (`top=4bl`, `space-before=1bl`, `offset-y=1bl`) to stay on it.
- `cols=` ranges are 1-indexed and inclusive: `1-8`, `9-12`, `5-end`, `all`. A range that does
  not fit a smaller grid (`9-12` on the phone's 4 columns) **linearizes the whole scene** there
  (frames stacked in source order, one column, warning W031). Prevent it with `cols@tablet=`,
  `cols@phone=`, or accept it with `linearize@phone=true`. An anchored object linearizes alone.

## Frames and stories

- **Inline frame**: `\frame[cols=1-8]{ \kicker{...} \headline{...} }` owns its text.
- **Threaded frame**: `\frame[story=main, cols=1-8, columns=2]` shows a slice of a
  `\story[name=main]{...}`. Every frame with `story=main` is the thread, in scene order then
  source order; text runs on from frame to frame, across scenes. `\framebreak` ends the current
  frame (all its columns); `\framebreak[column]` ends one column.
- A frame with automatic height takes everything to the next `\framebreak` or the story's end;
  one with a definite height (or any frame in a `screen` scene) takes what fits.
- `columns=2` sets internal columns; `columns=auto` takes as many as keep lines within `measure`
  (or about 64 characters). `measure=` caps line length in a wide frame: use it on any frame
  wider than about 75 characters of body text (warning W041 otherwise).
- `balance=true` (default) balances a frame's columns **by whole blocks**: paragraphs are not
  split; a lone paragraph stays in column 1. Give a balanced frame several paragraphs.
- `top=auto` (default) places a frame below every earlier sibling that overlaps its columns.
  `top=0` with `wrap=rect` on a heading frame lets text start beside it.
- `inset=`, `bg=` (a role or colour) and `valign=` (with a definite height) box a frame.
- `width`, `min-width`, `max-width` act only inside a row group.

## Column bands (page scenes)

A multi-column frame with automatic height in a `page` scene is set in **bands**: one set of
columns per screen, read top to bottom and left to right, then the next screen. What the
engine guarantees, so you can design for it:

- The first band starts under whatever is above it (a heading); later bands are a full screen.
- **Columns end together** on the screen's bottom line; where widows, orphans or a subhead
  kept with its paragraph would leave one short, the band is set up to six lines shorter until
  they end level. What cannot be levelled ends a line apart at most.
- **Pages end full**: a page with a photograph lets the photograph grow or crop by a few lines
  so the columns reach the foot.
- **No stubs**: never one or two lines under a picture in a column; a section's last page never
  holds three lines or fewer and nothing else.
- **Objects never interrupt a column**: an object that does not float waits for the top of the
  next column. Figures take whole baseline steps, captions included.
- The last band is balanced. A small arrow marks where a column's text continues.
- `woc check` prints the **copyfitting report**: for each screen that ends short, how many
  characters to add, or which picture could grow. Editing copy to fit is the magazine's way.
- On phones and tablets the frame is one column (`columns@phone=1` in the implicit form), not
  banded: it scrolls.

## Objects

`\figure` `\video` `\embed` `\lottie` `\audio` `\gallery` `\pullquote` `\sidebar` `\group`,
and `\rule` written directly in a scene.

**Two placements:**
- **Grid-placed**: written directly in a `\scene` (or `\group`): `cols=` plus `top=` (flow,
  page) or `rows=` (screen). Grid-placed objects do not push text unless `wrap=rect` or
  `contour`.
- **Anchored**: written in a story between paragraphs. It travels with the text.
  - `side=full` (default): the column's width; text stops above and resumes below.
  - `side=left|right, width=40%`: beside the text, which wraps it.
  - `side=center, width=...`: across the gutter of a two-column frame, text on both sides.
  - `cols=7-12`: pinned to absolute grid columns, reaching into a neighbouring frame or the
    margin; text in every frame it overlaps wraps it.

**Floating** (page scenes and multi-column frames, wide screens): an anchored figure, video,
gallery, pull quote or sidebar with `place=float` (the default) goes to the best **spot** near
its anchor: the anchor's screen, the one before or the one after, never two away.
- `size=hero` (the screen's subject, one per screen, all columns or all but one), `wide` (2-3
  columns), `column`, `small` (half a column at the anchor, text beside it), `auto` (landscape
  leans wide, portrait leans column).
- `place=here` (at the anchor), `top`, `bottom` (that edge of the anchor's screen), `screen`
  (a screen of its own).
- At most three floating objects and one hero per screen; no picture taller than 85% of a band;
  never a pull quote or fact box alone on a page. Phones and tablets: nothing floats.
- Writing an object next to its paragraph keeps it **within a screen** of it, not at it: the
  engine may set it at the top of the column or the screen before the paragraph. To keep it at
  its paragraph use `place=here` (or `size=small`, which is always at its anchor); to fix it
  to a screen edge use `place=top` or `bottom`.
- Steer with `size=`, by moving the anchor in the story, or with `place=`. A "Fallback: no
  spot" in the render check means no spot near the anchor held it: try a smaller `size`, or
  anchor it a paragraph or two later. The visor (V in `woc dev`) shows why each picture went
  where it did.

## Pictures

`\figure[src=, alt=, ratio=, fit=, focus=, shape=, clip=, caption-side=, loading=]{\caption{}\credit{}}`

- `ratio=auto` keeps the picture's own shape; `ratio=4:5` forces a box, `fit=cover` crops to it
  and `focus="30% 60%"` keeps that point in view. `fit=contain` shows it whole.
- `shape=alpha` with `wrap=contour` on a PNG with transparency (a cut-out) wraps text around its
  silhouette; in a band a cut-out is 150% of its column. An opaque picture falls back to a
  rectangle (W032).
- `caption-side=below|above|overlay`. Captions and credits travel with the picture and count in
  its box.
- `loading=eager` on the first screen's picture. JPEG, PNG and GIF are served as WebP; an
  animated GIF stays animated (a still under reduced motion).
- `src@phone=` gives a phone its own crop (art direction).
- `layer=background` fills the whole scene behind everything (`cols`, `rows`, `top` ignored).

## Wrap

`wrap=none|rect|contour|jump`, `wrap-side=both|left|right|largest`, `wrap-offset=1bl`.
Defaults: `rect` for anchored objects with a side or `cols`, `jump` for `side=full`, `none` for
grid-placed objects. Only the content layer wraps. Gaps narrower than the style's `min-slot`
(9em for Vanilla's body) are left empty rather than filled with slivers.

## Text objects

- `\pullquote[...]{Quoted words. \cite{Name}}`: an object, so it floats or sits beside the text
  (`side=right, width=40%`). The style's `mark` draws the quotation marks (Vanilla: an opening
  and a closing one), so write the words without quote marks.
- `\sidebar[bg=rule, inset=1bl, border=rule, portrait]{\title{...} paragraphs}`: a fact box;
  `portrait` narrows it to a panel taller than wide.
- `\blockquote{paragraphs \cite{...}}`: quoted text **in the flow**, set in from both sides,
  breaking across columns like body text. Not a pull quote.
- `span=all` on a text element in a multi-column frame crosses every column: a lede above
  columns, a crosshead between two sets of balanced columns. In page-scene bands only at a
  frame's start (W035 otherwise).
- `\dropcap[lines=3]` before a paragraph; `\endmark` after the last word.

## Groups

`\group[layout=stack|row, cols=, gap=, valign=top|center|bottom|stretch|text, stagger=]{...}`
holds objects, frames and groups as one unit.
- `stack`: children one below another at the group's width (a photo with its headline).
- `row`: children pack into rows of whole columns that wrap at every width: each child at least
  `min-width` (1 column), at most `max-width`, or exactly `width`. A row of photos that becomes a
  column on a phone needs no `@phone` values.
- `valign=text` makes a row as tall as its tallest text frame and crops its pictures to it.
- A group is placed in a scene; it cannot be anchored in a story in this version.

## Layers, colour and scene chrome

- `layer=background|content|overlay`, `z=` within a layer. A video or picture with
  `layer=background` and a frame on top is the classic opener.
- `palette=` on a scene switches every role inside it; `bg=` sets its paper. `palette@phone=`.
- `\folio[position=..., progress]{Label}` is the running head on every scene (`folio=hide` on a
  scene removes it); a `\parent` can carry its own.
- `\parent[name=chapter, ...]{children}` is a scene template: its attributes and children apply
  to every `\scene[parent=chapter]`. Parents do not chain.
- The page dots, the read-assist control and the sound control are automatic.

## Motion

- `enter=fade|rise|drop|slide-left|slide-right|zoom|wipe` (and `exit`, `enter-at`, `duration`,
  `delay`, `ease`, `replay`) on scenes, frames and objects. A scene's or group's `enter` passes
  to its children, `stagger` apart. Reveals never move layout.
- `turn=fade|slide` on a scene: how it arrives. `snap=soft|hard` on non-page scenes.
- Reduced motion turns all of it off; `motion=always` forces it and warns. Use motion
  sparingly: an opener's heading, a picture arriving, not every paragraph.
- `\music[src=...]` cues a soundtrack from that point; readers start sound with a tap.

## Responsive behaviour

Design every page at three sizes: phone (390), laptop (1280, `compact`, everything at 85%) and
desktop (1920, `wide`). Tools: `key@phone=` values on any attribute (`cols`, `columns`, `size`,
`hide`, `src`, `style`, `span`...), `at=` redefinitions of grids and styles, `hide@phone`, row
groups that rewrap by themselves, and the linearize fallback. On a phone the page is one
scrolling column: nothing floats, objects sit at their anchors, and scene heights still apply.
