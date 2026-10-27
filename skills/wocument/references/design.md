# Editorial design in Wocument

The engine already sets type well: baseline grid, paragraph composer, hyphenation, hanging
punctuation, balanced display lines, level columns, no stubs or widows. Your decisions are the
ones an art director makes: what leads, how big, where the pictures go, how the page breathes,
what the phone sees.

## Principles, and the feature that carries each

| Principle | In Wocument |
| :---- | :---- |
| **One thing leads each screen.** A picture or a headline, not both at full voice. | `size=hero` on one picture per screen; a `screen` scene for an opener; a quieter headline style (`extends=headline`) where a picture leads |
| **Clear hierarchy, few levels.** Kicker, headline, deck, byline; then body, subheads, captions. Three or four sizes, not eight. | Vanilla's styles; redefine sizes in the theme, not per element |
| **Contrast of scale.** A big display line against small text reads as designed; medium against medium reads as a document. | `fluid()` headline sizes, `fit=width` posters, small tracked kickers and credits |
| **Measure.** 45-75 characters a line for reading text. | `measure=`, `columns=auto`, the grid's `body` range; W064 and W041 flag it |
| **Rhythm.** Everything on the baseline; space in whole and half lines. | `bl` lengths everywhere; `space-before`/`space-after` in `bl` |
| **Density with relief.** Columns of text need an interruption every screen or two: a picture, a pull quote, a crosshead, an interlude. | Anchored figures and pull quotes at intervals; `span=all` crossheads; interlude scenes from a `\parent` |
| **Pictures carry pages.** Large, few, well cropped; a sequence with variety of scale (one wide, then a detail, then a portrait). | `size=` per picture; `ratio=`/`focus=` crops; galleries and row groups for sets |
| **Text and picture belong together.** A caption next to its picture, a pull quote near its passage. | Anchoring: write the object next to the paragraph it belongs to; floating keeps it within a screen |
| **Colour is a role.** Palettes per scene; one accent. | `palette=` on scenes; styles use roles |
| **Consistency across an edition.** Same grid, same type, same chrome; vary scenes, not systems. | One `.woct`, `\parent` templates, a shared `\folio` |
| **The phone is a first-class page.** One column, big pictures, short scenes. | `@phone` values, `hide@phone` for decoration only, `src@phone` crops, row groups |

## Page types

- **Opener**: a `height=screen` scene: a background picture or video (`layer=background`,
  `fit=cover`, `focus=`), a palette that keeps the text readable on it (usually `night`), a
  heading frame on the lower rows (`rows=4-6`, `valign=bottom`), `enter=rise` on the heading.
  On phones keep the heading short; check the picture's focus at 390px.
- **Feature**: the implicit form, or a `page` scene with a heading frame and a threaded story
  in columns. A lede `span=all` above the columns, a drop cap, two or three anchored pictures of
  different sizes, a pull quote, crossheads every few screens, a bio and an end mark.
- **Interview**: a short intro, then questions and answers. Questions as a style (`\style[name=q,
  extends=subhead, ...]` used with `\subhead[style=q]`) or bold prose, answers as body. A
  portrait of the subject early, a pull quote of their best line.
- **Photo essay**: pictures lead. `screen` scenes of one picture each with a line of caption, or
  row groups of two or three pictures (`\group[layout=row, valign=text]`), and short text frames
  between. Captions matter more than body copy here.
- **Brief / news**: one flow or page scene, a kicker, a plain headline, a short deck, body in one
  or two columns, one picture.
- **Fact box / data**: `\sidebar[portrait]{\title{...} ...}` beside the text; numbers in a
  character style (`\span[style=bignum]{40,000}`).
- **Closing**: a `\rule`, a `\bio`, credits; `\endmark` after the last word of the story.

## Working from references

When the user gives images or examples:

1. Name what makes them work: the grid (how many columns, how wide the margins), the type
   (serif or sans, the scale between headline and body, weight, case, tracking), the picture
   treatment (full-bleed, framed, cut-outs, duotone), the colour (paper, ink, one accent), the
   density, the rhythm of text and pictures.
2. Map each to a feature (table above). Note what does not map (see `capabilities.md`,
   "Limits": no scrims or tints over pictures, no lists or tables, no text on a path, no
   parallax) and choose the nearest supported treatment.
3. Build the theme first, then the pages. Do not copy the reference's text, images or logo.

## Pictures

- Use the user's pictures. Match each to its job by shape: landscape for wide and hero, portrait
  for column and small, a cut-out (PNG with transparency) where text should wrap a silhouette.
- Crop with `ratio=` and `focus=`, never by distorting (`fit=fill` stretches).
- Captions say what the reader cannot see (who, where, when); credits name the photographer.
- Missing pictures: name placeholder files clearly (`/img/placeholder-hero-16x9.jpg`) and say so.

## Copy

The copyfitting report (`woc check`) says how many characters each short screen needs. A
magazine edits copy to fit; propose the edit to the user rather than padding or cutting their
text yourself.
