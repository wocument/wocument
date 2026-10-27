# Checking and polishing a page

A page is done when `woc check` has no errors, every warning is fixed or explained, the render
check has no errors, and you have looked at every screen at every width and found nothing on
the checklist below.

## 1. `woc check`

```
woc check page.woc --public public
```

Errors stop the build: fix them first. Parse errors (`L…`, `P…`) give the line, the column and
usually the fix ("Did you mean \pullquote?"). Resolve errors (no code) name the problem: an
unknown style, grid, palette, story or token; a story with no visible frame at a breakpoint; a
theme file that is missing.

Warnings, and what to do:

| Code | Means | Usual fix |
| :---- | :---- | :---- |
| W030 | `snap=hard` on a flow scene was softened | `snap=soft`, or make the scene `screen` or `page` |
| W031 | A scene, or an anchored object, linearizes at a breakpoint: its `cols` do not fit that grid | add `cols@tablet=` / `cols@phone=`, or `linearize@phone=true` if stacking is what you want |
| W032 | `shape=alpha` on a picture with no transparency; set as a rectangle | use a PNG cut-out, or drop `shape=alpha` |
| W033 | Missing `alt` (figure, video, lottie) or `title` (embed, audio) | describe the picture; `alt=""` only for decoration |
| W034 | `motion=always` keeps motion under reduced motion | remove it unless the motion carries meaning |
| W035 | A value has no effect where it is written (a subhead level other than 1 or 2; `span=all` in the middle of page-scene bands) | change the value, or move the block to a frame's start |
| W050 | A file (picture, video, font, caption track) is missing | fix the path, or add the file under `--public` |
| W060 | Body text under 16px | raise the body size |
| W061 | Body leading under 1.4 times the size | a larger baseline step, or a smaller size |
| W062 | Ink, muted or accent under 4.5:1 against paper | darken or lighten that role in the palette |
| W063 | Body weight under 350 | use 400 or 500 |
| W064 | Body lines outside about 45-75 characters at a test width (30 on phones) | `measure=`, `columns=`, the frame's `cols`, or the text size, at those breakpoints |

After the warnings comes the **copyfitting report**: per screen of a page scene, how many lines
short it ends and how many characters would fill it, or which picture could grow; and any
picture set two screens or more from its paragraph. It is advice: propose the copy edit to the
user, or move a picture, rather than leave a short screen.

The spec also lists layout warnings W040 (a `\framebreak` with nowhere to go), W041 (a wide frame
with no `measure`), W042 (no slot wide enough) and W043 (an object taller than a band): the
engine does not report them yet. The render check and the screenshots catch their effects.

## 2. The render check

```
node skills/wocument/scripts/render-check.mjs page.woc --public public
```

It runs `woc check`, then lays the page out in Chromium at 390, 1280 and 1920 pixels with reduced
motion (so reveals hide nothing), scrolls through it, and writes `.woc-check/<name>/`:
`report.md`, `report.json`, and a screenshot of each screen (`w1280-s03.png`). `--widths` and
`--screens` change what it covers.

**Errors** (exit status 1): the page did not lay out, a file failed to load, a script error,
or the page scrolls sideways.

**Findings**, from the layout engine's own decisions (the visor's wording):

| Finding | What a reader sees | Usual fix |
| :---- | :---- | :---- |
| Empty room inside a column (N lines) | a hole in a column, often above a picture | move the picture's anchor, change its `size=`, or edit copy |
| Strip too narrow | a blank strip beside a picture or box | a wider or narrower `width=`, `side=full`, or `wrap=jump` |
| Levelled / Widows / Orphans (N lines) | a column set short so the page ends level, or text moved on | usually fine; many on one page means awkward paragraph lengths: edit copy |
| Cut to go on with the pictures / Short last page folded back | the engine reshaped a page around its pictures | check the screenshots: the page may be crowded |
| Fallback: no spot / search budget, Waited | a picture could not go where it was anchored | `size=column` or `small`, fewer pictures on that stretch of text, or move the anchor |
| Photograph cropped / Photograph grown | a photograph was cropped or extended to fill a page | check the crop: set `focus=`, or `fit=contain` if it must show whole |
| Screen ends short | a page ends short of its foot | the copyfitting report says how much copy fills it |
| Loose line / Tight line (N, the worst at X of a normal space) | justified lines with wide or squeezed gaps | at 2 or more on a phone: a narrower measure, `composer=paragraph`, hyphenation on, or `align=left` for that style at `phone` |

## 3. Look at the screenshots

Open every screenshot. Check, at each width:

- **Hierarchy**: one thing leads each screen; the headline is the biggest text; nothing competes.
- **Opener**: the heading is readable over its picture; the picture's subject is not cropped
  away at 390px (fix with `focus=` or `src@phone=`).
- **Columns**: they end level; no hole, no lonely line at a column's top or foot, no subhead at
  a column's foot; a crosshead is not stranded on the last line.
- **Pictures**: the right size for their job; crops keep the subject; captions sit with their
  pictures; no picture squeezed into a sliver; a sequence varies in scale.
- **Text boxes**: pull quotes and fact boxes beside the passage they belong to, never alone on a
  page.
- **Space**: margins and gaps consistent; nothing touching an edge; no screen nearly empty and
  none crammed. The article's last screen may end short; any other screen less than about two
  thirds full is a defect: a larger picture (`size=wide` or `hero`), a picture anchored later,
  or a copy edit to propose (the copyfitting report gives the numbers).
- **Phone**: one readable column; nothing hidden that the story needs; pictures large; scenes
  not absurdly tall or empty.
- **Colour**: text readable on every palette and over every background picture.
- **Words**: no widowed single word on a headline's or deck's last line (`balance` handles most);
  no placeholder text left by mistake.

Fix, then run the render check again. Two or three rounds is normal.

## 4. Live

`woc dev page.woc` opens the editor: the page updates as you type, Problems lists every
diagnostic at its line, and **V** on the page shows the visor: the grid, the bands, and why each
column ended and each picture went where it did. Use it to explain a layout decision to the
user.
