# @wocument/cli

The `woc` command (also installed as `wocument`).

```
woc parse <file>       print the AST as JSON
woc resolve <file>     print the Resolved Document as JSON
woc format <file...>   print canonical source (--write rewrites, --check only checks)
woc check <file...>    report every diagnostic and the copyfitting advice
woc build <file...>    a static site
```

`--public <dir>` (default `./public`) is where site-absolute paths such as `/img/a.jpg` are read from.
Relative paths are read from the document's folder. A `.woct` file is read as a theme.

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
