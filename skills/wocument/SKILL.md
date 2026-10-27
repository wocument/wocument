---
name: wocument
description: Create, design, edit and review Wocument pages - editorial articles and magazine pages written as .woc documents with .woct themes (the Wocument language, formerly WMXDSL). Use when the user asks for a Wocument article, page, edition, spread, opener, photo essay or theme; gives content, a brief, or visual references (screenshots, magazine spreads, mood boards) to turn into a Wocument page; or asks to change the layout, typography, palette, pictures or art direction of an existing .woc or .woct file. Produces complete, validated, visually inspected files, not mockups.
---

# Wocument pages

Wocument is a language for screen-native editorial layout: one `.woc` file holds an article's
content and design (scenes, grids, frames, threaded stories, wrap, type, reveals), and a `.woct`
theme holds shared design. A layout engine sets it in the reader's browser, for their screen.

Your job is a page a magazine art director would sign off: clear hierarchy, set type, pictures
that carry the page, and every screen size considered. A file that only parses is not done.

## Hard rules

1. **Only syntax that exists.** Every command and attribute you write must be in
   `references/commands.md`. Check `references/capabilities.md` for what it actually does: an
   attribute can be accepted and still do nothing in a given place. Never invent syntax, and
   never claim a feature works because the spec mentions it.
2. **Check, then look.** Every file passes `woc check`, and every page passes the render check
   with its screenshots inspected by you, at a phone, a laptop and a desktop width. Syntax alone
   is not polish.
3. **Say what the engine cannot do.** When a design asks for something the engine does not build
   (`references/capabilities.md`, "Limits"), use the best supported alternative and tell the
   user, in one line, what you did instead. Never hide a gap behind a workaround.
4. **Content is the author's.** Never invent facts, quotes, names, figures or credits. Use the
   user's words; where text is missing, write clearly marked placeholders (`[Standfirst: one
   sentence on ...]`) and say so. Pictures: only files the user gave, or clearly named
   placeholders. Every picture needs `alt` (or `alt=""` when it is decoration) that describes
   what the file shows; when a file does not show what the brief says (a stand-in), describe the
   brief's subject and tell the user the picture is a stand-in.
5. **Change what was asked.** On feedback, edit the parts in question; do not regenerate the
   document. Keep the user's text and decisions.

## Workflow

1. **Understand.** Content, audience, page types (opener, feature, interview, photo essay,
   brief), how many pages, and the feel. Read any references the user gave: images, PDFs, URLs,
   existing `.woc`/`.woct` files.
2. **Inventory.** List the text and pictures you have, with each picture's shape (landscape,
   portrait, square, cut-out with transparency). Ask only about what changes the design
   materially (no pictures at all, an edition-wide theme, a fixed brand font); assume the rest
   and say what you assumed.
3. **Plan.** Before writing: the edition's design system (`references/themes.md`), then per
   page the hierarchy, the scene sequence, which pictures lead, and how the page behaves on a
   phone (`references/design.md`, `references/composition.md`). For a reference image, write
   down the principles (grid, scale contrast, density, colour, picture treatment) and map each
   to a Wocument feature; do not trace the screenshot.
4. **Write.** Start from the closest recipe in `recipes/`. A theme `.woct` when there are two
   pages or more, or a design head when there is one. Keep design out of the content: styles
   and grids in the theme, `style=` on the rare exception.
5. **Validate.** `woc check page.woc --public <dir>` (`npx woc` inside this repository's
   workspace). Fix every error. Treat warnings as defects unless you can say why one is
   intended (`references/checking.md` lists each code and its usual fix).
6. **Render.** `node skills/wocument/scripts/render-check.mjs page.woc --public <dir>`
   (it writes to `.woc-check/<name>/` in the current folder unless `--out` says otherwise).
   Read `report.md`, then look at **every** screenshot at every width.
7. **Inspect and iterate.** Go through the checklist in `references/checking.md`: overflow,
   holes and short screens, loose lines, widows and stubs, pictures that found no spot or crop
   badly, crowded or empty screens, the phone version. Fix and render again until the report has
   no errors and nothing on the checklist is left that a reader would notice. A screen that is
   half empty, a picture that took a fallback spot, or a pull quote far from its passage is a
   defect to fix (`size=`, `place=`, moving the anchor), not a note for the summary; what
   you cannot fix, say why.
8. **Deliver.** The files, where they are, and a short summary: the design choices, what each
   page does on a phone, warnings you left on purpose and why, and any limit you designed
   around. Offer `woc dev page.woc` for the user to see it live and `woc build` to publish.

## Tools

| Command | What it gives you |
| :---- | :---- |
| `woc check <file...> [--public dir]` | Every diagnostic with line and fix, then the copyfitting report: how many characters to add or cut to fill each screen of a page scene |
| `node skills/wocument/scripts/render-check.mjs <file>` | Screenshots of every screen at 390, 1280 and 1920px, and what the layout engine noticed |
| `woc dev <file>` | The editor in a browser: source, live page, Problems tab; press V on the page for the visor, which explains every layout decision |
| `woc build <file> --out dist` | The publishable site |
| `woc format --write <file>` | Canonical formatting |

Site-absolute paths (`/img/a.jpg`) are read from `--public` (default `./public`); relative paths
from the document's folder.

## References

- `references/syntax.md`: how a file is written (shape, values, units, inline marks, escapes).
- `references/composition.md`: how the engine sets a page (scenes, grids, frames, threading,
  columns and bands, floating pictures, wrap, groups, layers, reveals) and how to steer it.
- `references/themes.md`: the cascade, Vanilla's defaults, writing a `.woct` theme.
- `references/design.md`: editorial design as Wocument features; page types; references.
- `references/checking.md`: the check and render workflow, every warning, the visual checklist.
- `references/commands.md`: every command and attribute, generated from the schema.
- `references/capabilities.md`: what every attribute does in practice, and the engine's limits.
- `recipes/`: tested starting points; each one passes `woc check`.
