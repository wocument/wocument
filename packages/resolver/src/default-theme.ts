/**
 * The built-in default theme (spec §16), as real `.wmxt` source. It sits at
 * cascade level 1 (§02.1) beneath any theme file and the document, and is
 * parsed by the same parser authors' themes go through.
 *
 * This is Vanilla, set value by value from 2026-09-27; it became the built-in
 * theme on 2026-10-07. The comments below give each value's date.
 *
 * Properties a style does not set come from the §07.6 default column, which
 * applies to every style. What §16 cannot say in the language
 * is resolver logic, not theme: the drop cap spanning `lines` steps, `cite`
 * and `endmark` taking the enclosing style, and `link` being underlined.
 */
export const DEFAULT_THEME_SOURCE = String.raw`
%% A fourth text column on screens 1800px and wider.
\breakpoint[name=phone, max=639px]
\breakpoint[name=tablet, min=640px, max=1023px]
\breakpoint[name=wide, min=1800px]
%% 2026-10-07: text a little smaller on a 13-inch laptop, 1024 to 1419px wide; 2026-10-09 to 1419
%% (from 1439), so a 1440px screen with a visible scroll bar (1425px of page) is still a laptop.
\breakpoint[name=compact, min=1024px, max=1419px]

%% The page frame, 2026-09-28 less white space: top and bottom margins of two lines (64px on a
%% laptop).
%% On wide screens only, figures, sidebars, quotes and the heading on the page's outer edge reach
%% into the side margin ("outdent"); text never does. 2026-09-28 halfway, 2026-09-30 a quarter.
%% 2026-09-30: the long-form web sizes, 21 / 21 / 19 / 18px, lines 33 / 33 / 30 / 28px.
%% 2026-10-07: wider side margins, 128px, 72px on tablets, 28px on phones.
\grid[name=default, cols=12, gutter=24px, margin-x=128px, margin-y=2bl, max=1440px, baseline=33px, rows=6, body=4-9]
\grid[name=default, at=wide, max=1760px, outdent=25%]
\grid[name=default, at=compact, baseline=31px]
\grid[name=default, at=tablet, cols=8, gutter=20px, margin-x=72px, margin-y=2bl, baseline=30px, body=2-7]
\grid[name=default, at=phone, cols=4, gutter=16px, margin-x=28px, margin-y=1.5bl, baseline=28px, body=all]

%% Cool grey paper, ink blue.
\palette[name=default, paper=#f6f7f8, ink=#16181d, muted=#5f6570, accent=#1f5fbf, rule=#dde1e6]

%% Georgia and Helvetica Neue. Body 20/32 (19/30, 18/28), 2026-09-30 21/33 on laptops and wide screens. A 1.25 scale from the body:
%% headline 5 steps up, pull quote 3, deck 2, subhead and lede 1, small text 1 and 2 down.
%% Half a line between paragraphs; 2026-09-30, on the grid, a first-line indent and no space
%% (a paragraph after a heading, subhead or picture starts flush), and justified.
%% A 2em indent.
%% 2026-10-07: no text in a strip beside a picture narrower than 9em.
%% 2026-10-07: lines broken for the whole paragraph; hyphens from words of 6 letters, never in a
%% capitalised word; lines under 12em (strips beside pictures) ragged right; quotes, hyphens, full
%% stops and commas hang outside the column.
\style[name=body, family="Georgia, serif", size=21px, leading=1bl, space-after=0, indent=2em, align=justify, min-slot=9em, composer=paragraph, hyphenate-min=6, hyphenate-caps=false, justify-min=12em, hang=punctuation]
\style[name=body, at=compact, size=20px]
\style[name=body, at=tablet, size=19px]
\style[name=body, at=phone, size=18px]
%% 2026-09-28: the intro one step smaller, 22px (a half step up from the body).
\style[name=lede, family="Georgia, serif", size=22px, leading=1.45em, space-after=0.5bl, snap=none, balance, hyphenate=false]
\style[name=lede, at=phone, size=20px]
%% 2026-10-07: the intro opens the story (not the heading), on the grid like the body.
\style[name=lede, size=22px, leading=1bl, snap=baseline, space-after=1bl, balance=false, composer=paragraph]
\style[name=lede, at=compact, size=21px]
\style[name=blockquote, family="Georgia, serif", italic, size=20px, leading=1bl, hang=punctuation]
%% 2026-09-28: headline, deck, intro and pull quote break into even lines ("balance"); the pull
%% quote is two steps smaller and opens with a large bold mark in the accent ("mark").
\style[name=headline, family="Georgia, serif", weight=700, size=fluid(35px, 61px), leading=1.05em, tracking=-0.01em, snap=none, hyphenate=false, balance]
\style[name=deck, family="Georgia, serif", italic, size=fluid(21px, 26px), leading=1.3em, color=muted, snap=none, balance, hyphenate=false]
\style[name=pullquote, family="Georgia, serif", italic, size=fluid(22px, 28px), leading=1.25em, color=ink, snap=none, balance, space-after=0, mark="“”"]
%% 2026-09-29: the pull quote's attribution smaller, upright, in the muted colour; 2026-09-30 set
%% right under the quote (no space between them, a tighter line).
\style[name=cite, size=17px, leading=1.2em, color=muted]

%% The heading block groups tight: kicker 8, headline 16, deck 24, byline and date together
%% (quarter lines: the heading block is a frame of its own, off the text's grid).
\style[name=kicker, family="Helvetica Neue, Helvetica, Arial, sans-serif", weight=600, size=13px, leading=0.5bl, case=upper, tracking=0.08em, color=accent, space-after=0.25bl, snap=none]
%% 2026-09-30, less space in the heading block: headline 12px after, deck and intro 16.
\style[name=headline, space-after=0.35bl]
\style[name=deck, space-after=0.5bl]
\style[name=byline, family="Helvetica Neue, Helvetica, Arial, sans-serif", weight=600, size=16px, leading=0.75bl, space-after=0, snap=none]
\style[name=meta, family="Helvetica Neue, Helvetica, Arial, sans-serif", size=13px, leading=0.75bl, color=muted, space-after=0, snap=none]

%% Subheads, 2026-09-28 less space, then a size up: subheads in letterspaced capitals, 18px.
%% 2026-09-29: subheads in the accent colour.
%% 2026-09-30, on the grid, with no rule: a line of space above, the subhead
%% on the next line, its text on the line after, so a subhead takes exactly two lines of the column.
\style[name=subhead, family="Helvetica Neue, Helvetica, Arial, sans-serif", weight=600, size=18px, leading=1bl, case=upper, tracking=0.08em, space-before=1bl, space-after=0, keep-with-next, color=accent]
\style[name=subhead-2, family="Helvetica Neue, Helvetica, Arial, sans-serif", weight=700, size=20px, leading=1bl, space-before=1bl, space-after=0, keep-with-next]

%% Captions, 2026-09-28 in serif italics, grey, a step smaller; the sidebar's voice.
\style[name=caption, family="Georgia, serif", italic, size=15px, leading=1.4em, color=muted, snap=none]
\style[name=credit, family="Helvetica Neue, Helvetica, Arial, sans-serif", size=13px, leading=1.4em, case=upper, tracking=0.06em, color=muted, snap=none]
\style[name=sidebar, family="Helvetica Neue, Helvetica, Arial, sans-serif", size=16px, leading=1.5em, snap=none]
\style[name=bio, family="Helvetica Neue, Helvetica, Arial, sans-serif", italic, size=16px, leading=0.75bl, color=muted, snap=none]
\style[name=folio, family="Helvetica Neue, Helvetica, Arial, sans-serif", weight=600, size=12px, case=upper, tracking=0.08em]

%% 2026-09-28: Vanilla has drop caps: three lines deep, in the headline's face, in the accent.
\style[name=dropcap, extends=headline, family="Georgia, serif", weight=700, color=accent]
%% 2026-10-07: a regular-weight headline, the deck in ink and
%% upright, a small tracked rubric in ink, a sans byline; every gap a whole or half line.
\style[name=kicker, weight=500, size=12px, tracking=0.14em, color=ink, space-after=1bl]
\style[name=headline, weight=400, size=fluid(40px, 72px), leading=1.06em, tracking=-0.015em, space-after=0.75bl]
\style[name=deck, italic=false, color=ink, size=fluid(21px, 25px), leading=1.4em, space-after=1.5bl]
\style[name=byline, weight=500, size=14px]
%% Sidebar and box titles; character styles for links and code.
\style[name=title, extends=sidebar, weight=700, hyphenate=false]
%% 2026-10-07: subheads break into even lines, and no display line ends on a short
%% word (a, the, of, to...).
\style[name=subhead, balance, bind-short]
\style[name=headline, bind-short]
\style[name=deck, bind-short]
\style[name=lede, bind-short=false]
\style[name=pullquote, bind-short]
\style[name=link, color=accent]
\style[name=code, family="monospace", size=0.9em]
`;
