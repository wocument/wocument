# Themes and the design system

## The cascade

Later wins, property by property (§02.1):

1. Vanilla, the built-in theme
2. The theme file (`theme: ./edition.woct` in frontmatter; one per document)
3. The document's design head
4. The scene's parent (`\parent`)
5. The scene
6. The element (`style=`, attributes)
7. A breakpoint value (`key@phone=`) of any of the above

A definition that reuses a name **replaces it property by property**: `\style[name=body,
size=20px]` keeps everything else Vanilla's body has. `at=phone` on `\grid`, `\style` or
`\parent` redefines that name for one breakpoint, taking unset properties from the same level's
base definition.

**One edition, one theme.** Put palettes, grids, styles, spots, parents and the folio style in a
`.woct`; keep each page's design head for what is truly that page's. Restyle an element type by
redefining its style (`\style[name=headline, ...]`); style one instance with a new style that
`extends` it and `style=` on the element.

## Vanilla, the default

You get this with no design at all. Design from it: change what the edition needs, keep the rest.

- **Breakpoints**: `phone` to 639px, `tablet` 640-1023, `compact` 1024-1799 (laptops: the base
  page at 85%), `wide` 1800 and up. No width falls in the base range; `wide` inherits base.
- **Grid `default`**: 12 columns (8 tablet, 4 phone); gutter 24px (20 compact and tablet, 16
  phone); margin-x 128px (108, 72, 28); margin-y 2bl; baseline 33px (28 compact, 30 tablet, 28
  phone); max 1440px (1760 wide, 1224 compact); body 4-9 (2-7 tablet, all phone).
- **Palette `default`**: paper `#f6f7f8`, ink `#16181d`, muted `#5f6570`, accent `#1f5fbf`,
  rule `#dde1e6`.
- **Type**: Georgia for text and display, Helvetica Neue for labels. Body 21px (18 compact, 19
  tablet, 18 phone) on one baseline step, justified with the paragraph composer, hyphenated
  (not capitalised words), 2em indent, hanging punctuation. Headline `fluid(40px, 72px)` regular
  weight, balanced. Deck `fluid(21px, 25px)`. Kicker 12px upper case, tracked. Subhead 18px sans
  upper case in the accent, kept with the next paragraph. Pull quote italic
  `fluid(22px, 28px)` with marks. Captions 15px italic muted; credits 13px upper case muted.
- **Spots**: hero top (all, or all but one column); wide top or bottom (2-3 columns); column
  top, bottom or at the anchor; small at the anchor, left or right.

`wocument-specification.md` §16 has the full tables.

## Writing a theme

```
%% edition.woct
\token[name=ember, value=#c8442b]
\palette[name=default, paper=#f7f4ee, ink=#1b1a17, muted=#6b665d, accent=$ember, rule=#ddd6c8]
\palette[name=night, paper=#0f1012, ink=#efebe3, muted=#9b968d, accent=#e0a458, rule=#2b2c30]

\style[name=headline, family="Didot, Georgia, serif", weight=400, size=fluid(44px, 96px), tracking=-0.02em]
\style[name=kicker, color=accent]
\style[name=headline-quiet, extends=headline, size=fluid(32px, 56px)]

\grid[name=wide-margins, cols=12, gutter=24px, margin-x=160px, max=1200px, baseline=30px, body=3-10]
\grid[name=wide-margins, at=tablet, cols=8, margin-x=56px, body=2-7]
\grid[name=wide-margins, at=phone, cols=4, gutter=16px, margin-x=24px, baseline=28px, body=all]

\parent[name=interlude, height=screen, palette=night, snap=soft, enter=fade]
```

### Colour

- A palette always names all five roles: `paper` (background), `ink` (text), `muted`
  (captions, meta, credits), `accent` (kickers, links, drop caps, subheads, pull-quote marks),
  `rule` (rules, borders, fact-box fills). Styles use roles, so a scene's `palette=` restyles
  everything in it.
- Ink, muted and accent need **4.5:1** contrast against paper (W062). Check dark palettes too.
- One accent per palette. A second palette (`night`) for openers and interludes is usually
  enough contrast for an edition.

### Type

- **Fonts**: a family must be a system font, a generic family (`serif`, `sans-serif`,
  `monospace`), or registered with `\font[family=, src=, weight=, italic]` from a file you have
  the right to serve (WOFF2, under `public/`). Always end a family list with a fallback:
  `family="Source Serif 4, Georgia, serif"`. Do not reference a font file that is not there
  (W050, and the text falls back).
- **Body**: 18-21px, leading one baseline step, the baseline 1.4-1.65 times the size (W061
  under 1.4); weight 350 or more (W063); 16px at least (W060). Lines of 45-75 characters (W064).
- **Scale**: a clear step between levels. Display styles (`headline`, `deck`, `pullquote`) want
  `snap=none`, `balance`, `bind-short`, `hyphenate=false`; text styles snap to the baseline.
- `fit=width, fit-max=, fit-height=` sets a headline at the largest size that keeps every word
  whole: a poster headline that fills its frame.
- `case=small-caps` and `features="smcp onum"` need fonts that have them.

### Grids

- Keep `baseline` equal to the body leading so every column shares baselines.
- Redefine every grid at `tablet` and `phone` (fewer columns, smaller margins); otherwise a
  `cols=9-12` placement linearizes there.
- `outdent=25%` lets pictures and heading frames on the grid's outer columns reach into the
  margin on wide screens.

### Spots

A theme's `\spot` rows replace Vanilla's for each size they name. Change them to set the
edition's picture rhythm, for example heroes always across all columns:
`\spot[size=hero, place=top, span=all]`.
