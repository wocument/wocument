# @wocument/cli

The `woc` command (also installed as `wocument`).

```
woc parse <file>       print the AST as JSON
woc resolve <file>     print the Resolved Document as JSON
woc format <file...>   print canonical source (--write rewrites, --check only checks)
woc check <file...>    report every diagnostic and the copyfitting advice
woc build <file...>    a static site
woc dev [file|folder]  the editor and a live page
```

`--public <dir>` (default `./public`) is where site-absolute paths such as `/img/a.jpg` are read from.
Relative paths are read from the document's folder. A `.woct` file is read as a theme.

## woc dev

```
woc dev article.woc
```

opens the editor in the browser: the source on the left, the page on the right, laid out as you type. It shows every `.woc` file in the article's folder (`woc dev` alone: this folder). A file that does not exist yet starts from a short template.

- **Save** (Cmd/Ctrl-S) writes the file. Edits you have not saved are kept in this browser until you save or revert.
- Edit in your own editor if you prefer: when you save there, the open pages show the new version.
- **Page** opens the page alone. `woc dev --host` also listens on your network, so a phone can open it; saving still works from this machine only.
- Pictures show as WebP, as `woc build` ships them. The first time, a picture shows as it is for a moment while its WebP is made (typically under 2 s for an article); WebP files are kept in the system cache folder (`~/Library/Caches/wocument` on macOS, `~/.cache/wocument` on Linux), so each picture converts once.
- Press **V** on a page for the visor: it marks the grid and lines and explains each layout decision.
- **Problems** lists errors and warnings at their line; **Resolved** shows the Resolved Document.

`--port <n>` is the first port to try (default 5190). `--no-open` does not open the browser.

## woc build

```
woc build article.woc --out dist
```

writes

```
dist/index.html        the page: the reading version and the document's data
dist/woc.<hash>.js     the page's script: layout, renderer and text engine
dist/assets/           every file the page uses, named by its content
```

Upload `dist/` to any static host. The page lays itself out in the reader's browser, for their screen, and again when the window resizes. Without JavaScript the reader sees the reading version: the whole text in one column.

- One input gives `index.html`; several give `<name>.html` each, sharing one script and one `assets/` folder.
- JPEG, PNG and GIF pictures are converted to WebP (an animated GIF stays animated). `--no-webp` keeps them as they are.
- A missing picture or font is a warning: the page is still built. A parse or resolve error fails the build (exit status 1) and writes no page for that file.
- Files from earlier builds stay in the folder. Delete it for a clean build.
