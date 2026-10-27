# Wocument command schema

### \audio  — spec §11.8

class: block · body: optional (struct)
children: caption credit
at most once: caption credit

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | none | not responsive; auto-generated when omitted |
| `cols` | range | none | defaults to the grid's body range |
| `rows` | range | all | screen scenes only |
| `top` | auto or length | auto | flow scenes only |
| `height` | auto or length | auto |  |
| `bleed` | none left right both | none |  |
| `max-width` | fluid or length | none | caps the box width; the box keeps the centre of the space it was given. In a row group: the widest it may grow |
| `min-width` | fluid or length | none | row groups only: the narrowest it may be, rounded up to whole columns |
| `offset-x` | length | 0 |  |
| `offset-y` | length | 0 |  |
| `layer` | background content overlay | content |  |
| `z` | integer | none | defaults to source order |
| `hide` | boolean | false |  |
| `side` | full left right center | full | anchored objects; spec §11.3. center: centred in the column, text on both sides where the gap is wide enough |
| `width` | length | none | anchored objects with side=left|right, % of the column; in a row group, a fixed width rounded to whole columns |
| `wrap` | none rect contour jump | none | default depends on placement mode: rect when anchored with side=left|right or cols, jump for side=full, none when grid-placed |
| `wrap-side` | both left right largest | largest |  |
| `wrap-offset` | length | 1bl |  |
| `enter` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `exit` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `enter-at` | percentage | 15% |  |
| `duration` | time | 600ms |  |
| `delay` | time | 0ms |  |
| `ease` | standard in out linear | standard |  |
| `replay` | boolean | false |  |
| `motion` | always | none | spec §13 rule 3; emits a resolve warning |
| `src` | path | required |  |
| `title` | string | none | missing is a warning |
| `captions` | path | none |  |
| `transcript` | path | none |  |

### \bio  — spec §10.3

class: block · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | none |  |
| `span` | all | none |  |

### \blockquote  — spec §10.3

class: block · body: required (block)
children: #paragraph cite
at most once: cite

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | none |  |
| `span` | all | none |  |

### \br  — spec §10.2

class: inline · body: none

_No attributes._

### \breakpoint  — spec §07.4

class: block · body: none

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | required | not responsive |
| `min` | length | none | not responsive |
| `max` | length | none | not responsive |

### \byline  — spec §10.3

class: block · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | none |  |
| `span` | all | none |  |

### \caption  — spec §10.3

class: block · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | none |  |
| `span` | all | none |  |

### \cite  — spec §10.3

class: block · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | none |  |
| `span` | all | none |  |

### \credit  — spec §10.3

class: block · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | none |  |
| `span` | all | none |  |

### \deck  — spec §10.3

class: block · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | none |  |
| `span` | all | none |  |

### \dropcap  — spec §10.4

class: block · body: none

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `lines` | integer | 3 |  |
| `chars` | integer | 1 |  |
| `quote` | inside hang omit | hang | an opening quotation mark: part of the cap, hung outside the column, or left out |

### \embed  — spec §11.6

class: block · body: optional (struct)
children: caption credit
at most once: caption credit
rule (P016): provider=youtube|vimeo requires id; provider=iframe requires url

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | none | not responsive; auto-generated when omitted |
| `cols` | range | none | defaults to the grid's body range |
| `rows` | range | all | screen scenes only |
| `top` | auto or length | auto | flow scenes only |
| `height` | auto or length | auto |  |
| `bleed` | none left right both | none |  |
| `max-width` | fluid or length | none | caps the box width; the box keeps the centre of the space it was given. In a row group: the widest it may grow |
| `min-width` | fluid or length | none | row groups only: the narrowest it may be, rounded up to whole columns |
| `offset-x` | length | 0 |  |
| `offset-y` | length | 0 |  |
| `layer` | background content overlay | content |  |
| `z` | integer | none | defaults to source order |
| `hide` | boolean | false |  |
| `side` | full left right center | full | anchored objects; spec §11.3. center: centred in the column, text on both sides where the gap is wide enough |
| `width` | length | none | anchored objects with side=left|right, % of the column; in a row group, a fixed width rounded to whole columns |
| `wrap` | none rect contour jump | none | default depends on placement mode: rect when anchored with side=left|right or cols, jump for side=full, none when grid-placed |
| `wrap-side` | both left right largest | largest |  |
| `wrap-offset` | length | 1bl |  |
| `enter` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `exit` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `enter-at` | percentage | 15% |  |
| `duration` | time | 600ms |  |
| `delay` | time | 0ms |  |
| `ease` | standard in out linear | standard |  |
| `replay` | boolean | false |  |
| `motion` | always | none | spec §13 rule 3; emits a resolve warning |
| `caption-side` | below above overlay | below |  |
| `provider` | youtube vimeo iframe | required | not responsive |
| `id` | string | none | for youtube and vimeo |
| `url` | path | none | for iframe |
| `title` | string | none | accessible name; missing is a warning |
| `ratio` | ratio | 16:9 |  |
| `poster` | path | none | defaults to the provider thumbnail |
| `facade` | boolean | true |  |

### \endmark  — spec §10.4

class: inline · body: none

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `glyph` | string | "■" |  |

### \figure  — spec §11.4

class: block · body: optional (struct)
children: caption credit
at most once: caption credit

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | none | not responsive; auto-generated when omitted |
| `cols` | range | none | defaults to the grid's body range |
| `rows` | range | all | screen scenes only |
| `top` | auto or length | auto | flow scenes only |
| `height` | auto or length | auto |  |
| `bleed` | none left right both | none |  |
| `max-width` | fluid or length | none | caps the box width; the box keeps the centre of the space it was given. In a row group: the widest it may grow |
| `min-width` | fluid or length | none | row groups only: the narrowest it may be, rounded up to whole columns |
| `offset-x` | length | 0 |  |
| `offset-y` | length | 0 |  |
| `layer` | background content overlay | content |  |
| `z` | integer | none | defaults to source order |
| `hide` | boolean | false |  |
| `side` | full left right center | full | anchored objects; spec §11.3. center: centred in the column, text on both sides where the gap is wide enough |
| `width` | length | none | anchored objects with side=left|right, % of the column; in a row group, a fixed width rounded to whole columns |
| `wrap` | none rect contour jump | none | default depends on placement mode: rect when anchored with side=left|right or cols, jump for side=full, none when grid-placed |
| `wrap-side` | both left right largest | largest |  |
| `wrap-offset` | length | 1bl |  |
| `enter` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `exit` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `enter-at` | percentage | 15% |  |
| `duration` | time | 600ms |  |
| `delay` | time | 0ms |  |
| `ease` | standard in out linear | standard |  |
| `replay` | boolean | false |  |
| `motion` | always | none | spec §13 rule 3; emits a resolve warning |
| `size` | hero wide column small auto | auto | how big the object is on a wide page; auto: the engine chooses |
| `place` | float here top bottom screen | float | float: the best spot near the text; here: where it stands in the text |
| `shape` | rect circle ellipse alpha or poly | rect |  |
| `clip` | boolean | false |  |
| `alpha-threshold` | percentage | 50% | only with shape=alpha |
| `caption-side` | below above overlay | below |  |
| `src` | path | required | give the highest resolution available |
| `alt` | string | none | missing alt is a resolve warning; alt="" is decorative |
| `ratio` | ratio | auto |  |
| `fit` | cover contain fill none | cover |  |
| `focus` | pair(percentage) | "50% 50%" |  |
| `loading` | lazy eager | lazy |  |

### \folio  — spec §10.5

class: block · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `position` | top-left top-right bottom-left bottom-right margin-left margin-right | top-left |  |
| `progress` | boolean | false |  |
| `style` | ident | none |  |

### \font  — spec §07.1

class: block · body: none

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `family` | string | required | not responsive |
| `src` | path | required | not responsive |
| `weight` | integer or range | 400 | not responsive; a range for a variable font |
| `italic` | boolean | false | not responsive |

### \frame  — spec §09.2

class: block · body: optional (block)
children: #paragraph kicker headline deck byline meta lede subhead bio blockquote credit dropcap framebreak rule music figure video embed lottie audio gallery pullquote sidebar
rule (P044): a frame with story= takes no body

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | none | not responsive; auto-generated when omitted |
| `story` | ident | none | not responsive; when set, the frame takes no body |
| `cols` | range | none | defaults to the grid's body range |
| `rows` | range | all | screen scenes only |
| `top` | auto or length | auto | flow scenes only |
| `height` | auto or length | auto | flow scenes only |
| `columns` | integer or auto | 1 | internal columns; auto fits them to the measure |
| `column-gap` | length | none | defaults to the grid's gutter |
| `balance` | boolean | true |  |
| `column-rule` | none rule | none | design 2026-09-22 §4 |
| `valign` | top center bottom | top |  |
| `measure` | none or fluid or length | none | caps every line's width |
| `inset` | length | 0 |  |
| `bg` | role or color | none |  |
| `z` | integer | none | defaults to source order |
| `hide` | boolean | false |  |
| `wrap` | none rect | none | rect: the frame's box cuts into frames set after it, like an object's (§09.2) |
| `wrap-offset` | length | 1bl |  |
| `width` | fit or length | none | row groups only: a fixed width, rounded to whole columns; fit: the columns its widest line needs |
| `min-width` | fluid or length | none | row groups only: the narrowest it may be, rounded up to whole columns |
| `max-width` | fluid or length | none | row groups only: the widest it may grow, rounded down to whole columns |
| `enter` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `exit` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `enter-at` | percentage | 15% |  |
| `duration` | time | 600ms |  |
| `delay` | time | 0ms |  |
| `ease` | standard in out linear | standard |  |
| `replay` | boolean | false |  |
| `motion` | always | none | spec §13 rule 3; emits a resolve warning |

### \framebreak  — spec §09.3

class: block · body: none

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `column` | boolean | false | ends only the current internal column |

### \gallery  — spec §11.9

class: block · body: required (struct)
children: figure video caption credit
at most once: caption credit

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | none | not responsive; auto-generated when omitted |
| `cols` | range | none | defaults to the grid's body range |
| `rows` | range | all | screen scenes only |
| `top` | auto or length | auto | flow scenes only |
| `height` | auto or length | auto |  |
| `bleed` | none left right both | none |  |
| `max-width` | fluid or length | none | caps the box width; the box keeps the centre of the space it was given. In a row group: the widest it may grow |
| `min-width` | fluid or length | none | row groups only: the narrowest it may be, rounded up to whole columns |
| `offset-x` | length | 0 |  |
| `offset-y` | length | 0 |  |
| `layer` | background content overlay | content |  |
| `z` | integer | none | defaults to source order |
| `hide` | boolean | false |  |
| `side` | full left right center | full | anchored objects; spec §11.3. center: centred in the column, text on both sides where the gap is wide enough |
| `width` | length | none | anchored objects with side=left|right, % of the column; in a row group, a fixed width rounded to whole columns |
| `wrap` | none rect contour jump | none | default depends on placement mode: rect when anchored with side=left|right or cols, jump for side=full, none when grid-placed |
| `wrap-side` | both left right largest | largest |  |
| `wrap-offset` | length | 1bl |  |
| `enter` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `exit` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `enter-at` | percentage | 15% |  |
| `duration` | time | 600ms |  |
| `delay` | time | 0ms |  |
| `ease` | standard in out linear | standard |  |
| `replay` | boolean | false |  |
| `motion` | always | none | spec §13 rule 3; emits a resolve warning |
| `size` | hero wide column small auto | auto | how big the object is on a wide page; auto: the engine chooses |
| `place` | float here top bottom screen | float | float: the best spot near the text; here: where it stands in the text |
| `caption-side` | below above overlay | below |  |
| `layout` | grid strip | grid |  |
| `per-row` | integer | 3 | grid layout only |
| `gap` | length | none | defaults to the grid's gutter |
| `ratio` | ratio | auto | forced on every child when set |

### \grid  — spec §07.5

class: block · body: none

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | default | not responsive |
| `at` | ident | none | not responsive; redefines this grid for one breakpoint |
| `cols` | integer | 12 |  |
| `gutter` | length | 24px |  |
| `margin-x` | length | 64px |  |
| `margin-y` | length | 4bl |  |
| `margin` | length | none | shorthand for margin-x and margin-y |
| `max` | length | 1440px |  |
| `baseline` | length | 28px | defines the bl unit |
| `rows` | integer | 6 | screen-height scenes only |
| `row-gap` | length | none | defaults to gutter |
| `body` | range | 4-9 | columns used by the default frame |
| `outdent` | length | 0 | how far an object on the grid's outer edge reaches into the margin |

### \group  — spec §11.11

class: block · body: required (struct)
children: frame rule figure video embed lottie audio gallery pullquote sidebar group

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | none | not responsive; auto-generated when omitted |
| `cols` | range | none | defaults to the grid's body range |
| `rows` | range | all | screen scenes only |
| `top` | auto or length | auto | flow scenes only |
| `height` | auto or length | auto |  |
| `bleed` | none left right both | none |  |
| `max-width` | fluid or length | none | caps the box width; the box keeps the centre of the space it was given. In a row group: the widest it may grow |
| `min-width` | fluid or length | none | row groups only: the narrowest it may be, rounded up to whole columns |
| `offset-x` | length | 0 |  |
| `offset-y` | length | 0 |  |
| `layer` | background content overlay | content |  |
| `z` | integer | none | defaults to source order |
| `hide` | boolean | false |  |
| `side` | full left right center | full | anchored objects; spec §11.3. center: centred in the column, text on both sides where the gap is wide enough |
| `width` | length | none | anchored objects with side=left|right, % of the column; in a row group, a fixed width rounded to whole columns |
| `wrap` | none rect contour jump | none | default depends on placement mode: rect when anchored with side=left|right or cols, jump for side=full, none when grid-placed |
| `wrap-side` | both left right largest | largest |  |
| `wrap-offset` | length | 1bl |  |
| `enter` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `exit` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `enter-at` | percentage | 15% |  |
| `duration` | time | 600ms |  |
| `delay` | time | 0ms |  |
| `ease` | standard in out linear | standard |  |
| `replay` | boolean | false |  |
| `motion` | always | none | spec §13 rule 3; emits a resolve warning |
| `stagger` | time | 80ms |  |
| `layout` | stack row | stack | row: children pack into rows that wrap (design 2026-09-26) |
| `gap` | length | 1bl | between children in a stack, between rows in a row group |
| `valign` | top center bottom stretch text | top | row groups: how a child shorter than its row sits in it; text: the row is as tall as its text, media cropped to it |

### \headline  — spec §10.3

class: block · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | none |  |
| `span` | all | none |  |

### \kicker  — spec §10.3

class: block · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | none |  |
| `span` | all | none |  |

### \lede  — spec §10.3

class: block · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | none |  |
| `span` | all | none |  |

### \lottie  — spec §11.7

class: block · body: optional (struct)
children: caption credit
at most once: caption credit

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | none | not responsive; auto-generated when omitted |
| `cols` | range | none | defaults to the grid's body range |
| `rows` | range | all | screen scenes only |
| `top` | auto or length | auto | flow scenes only |
| `height` | auto or length | auto |  |
| `bleed` | none left right both | none |  |
| `max-width` | fluid or length | none | caps the box width; the box keeps the centre of the space it was given. In a row group: the widest it may grow |
| `min-width` | fluid or length | none | row groups only: the narrowest it may be, rounded up to whole columns |
| `offset-x` | length | 0 |  |
| `offset-y` | length | 0 |  |
| `layer` | background content overlay | content |  |
| `z` | integer | none | defaults to source order |
| `hide` | boolean | false |  |
| `side` | full left right center | full | anchored objects; spec §11.3. center: centred in the column, text on both sides where the gap is wide enough |
| `width` | length | none | anchored objects with side=left|right, % of the column; in a row group, a fixed width rounded to whole columns |
| `wrap` | none rect contour jump | none | default depends on placement mode: rect when anchored with side=left|right or cols, jump for side=full, none when grid-placed |
| `wrap-side` | both left right largest | largest |  |
| `wrap-offset` | length | 1bl |  |
| `enter` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `exit` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `enter-at` | percentage | 15% |  |
| `duration` | time | 600ms |  |
| `delay` | time | 0ms |  |
| `ease` | standard in out linear | standard |  |
| `replay` | boolean | false |  |
| `motion` | always | none | spec §13 rule 3; emits a resolve warning |
| `size` | hero wide column small auto | auto | how big the object is on a wide page; auto: the engine chooses |
| `place` | float here top bottom screen | float | float: the best spot near the text; here: where it stands in the text |
| `shape` | rect circle ellipse alpha or poly | rect |  |
| `clip` | boolean | false |  |
| `alpha-threshold` | percentage | 50% | only with shape=alpha |
| `caption-side` | below above overlay | below |  |
| `src` | path | required | .json or .lottie |
| `alt` | string | none |  |
| `play` | manual visible auto | visible |  |
| `loop` | boolean | true |  |
| `ratio` | ratio | none | defaults to the ratio in the file |

### \meta  — spec §10.3

class: block · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | none |  |
| `span` | all | none |  |

### \music  — spec §10.6

class: block · body: none

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `src` | none or path | required | not responsive; a sound file, or none to fade out |
| `fade` | time | 2s | not responsive; crossfade or fade-out length |
| `volume` | percentage | 80% | not responsive |
| `loop` | boolean | true | not responsive |
| `enter-at` | percentage | 50% | not responsive; how far up the screen the cue fires, from the bottom (as reveals) |

### \palette  — spec §07.3

class: block · body: none

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | required | not responsive |
| `paper` | color | none |  |
| `ink` | color | none |  |
| `muted` | color | none |  |
| `accent` | color | none |  |
| `rule` | color | none |  |

### \parent  — spec §08.4

class: block · body: optional (scene)
children: frame group figure video embed lottie audio gallery pullquote sidebar #paragraph kicker headline deck byline meta lede subhead bio blockquote credit dropcap framebreak rule music folio
at most once: folio

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | required | not responsive |
| `at` | ident | none | not responsive |
| `grid` | ident | default |  |
| `palette` | ident | default |  |
| `height` | flow screen page | flow |  |
| `snap` | none soft hard | none |  |
| `turn` | none fade slide | none | page turn, design 2026-09-22 §3 |
| `bg` | role or color | paper |  |
| `linearize` | boolean | false |  |
| `folio` | show hide | show |  |
| `enter` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `exit` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `enter-at` | percentage | 15% |  |
| `duration` | time | 600ms |  |
| `delay` | time | 0ms |  |
| `ease` | standard in out linear | standard |  |
| `replay` | boolean | false |  |
| `motion` | always | none | spec §13 rule 3; emits a resolve warning |
| `stagger` | time | 80ms |  |

### \pullquote  — spec §11.10

class: block · body: required (block)
children: #paragraph cite
at most once: cite

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | none | not responsive; auto-generated when omitted |
| `cols` | range | none | defaults to the grid's body range |
| `rows` | range | all | screen scenes only |
| `top` | auto or length | auto | flow scenes only |
| `height` | auto or length | auto |  |
| `bleed` | none left right both | none |  |
| `max-width` | fluid or length | none | caps the box width; the box keeps the centre of the space it was given. In a row group: the widest it may grow |
| `min-width` | fluid or length | none | row groups only: the narrowest it may be, rounded up to whole columns |
| `offset-x` | length | 0 |  |
| `offset-y` | length | 0 |  |
| `layer` | background content overlay | content |  |
| `z` | integer | none | defaults to source order |
| `hide` | boolean | false |  |
| `side` | full left right center | full | anchored objects; spec §11.3. center: centred in the column, text on both sides where the gap is wide enough |
| `width` | length | none | anchored objects with side=left|right, % of the column; in a row group, a fixed width rounded to whole columns |
| `wrap` | none rect contour jump | none | default depends on placement mode: rect when anchored with side=left|right or cols, jump for side=full, none when grid-placed |
| `wrap-side` | both left right largest | largest |  |
| `wrap-offset` | length | 1bl |  |
| `enter` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `exit` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `enter-at` | percentage | 15% |  |
| `duration` | time | 600ms |  |
| `delay` | time | 0ms |  |
| `ease` | standard in out linear | standard |  |
| `replay` | boolean | false |  |
| `motion` | always | none | spec §13 rule 3; emits a resolve warning |
| `size` | hero wide column small auto | auto | how big the object is on a wide page; auto: the engine chooses |
| `place` | float here top bottom screen | float | float: the best spot near the text; here: where it stands in the text |
| `style` | ident | none |  |

### \rule  — spec §10.4

class: block · body: none

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | none | not responsive; auto-generated when omitted |
| `weight` | length | 1px |  |
| `color` | role or color | rule |  |
| `width` | length | 100% |  |
| `align` | left center right | left |  |
| `cols` | range | none |  |
| `rows` | range | all |  |
| `top` | auto or length | auto |  |
| `offset-x` | length | 0 |  |
| `offset-y` | length | 0 |  |
| `z` | integer | none |  |
| `hide` | boolean | false |  |

### \scene  — spec §08.1

class: block · body: required (scene)
children: frame group figure video embed lottie audio gallery pullquote sidebar #paragraph kicker headline deck byline meta lede subhead bio blockquote credit dropcap framebreak rule music

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | none | not responsive; auto-generated when omitted |
| `grid` | ident | default |  |
| `parent` | ident | none | not responsive |
| `palette` | ident | default |  |
| `height` | flow screen page | flow |  |
| `snap` | none soft hard | none |  |
| `turn` | none fade slide | none | page turn, design 2026-09-22 §3 |
| `bg` | role or color | paper |  |
| `linearize` | boolean | false |  |
| `folio` | show hide | show |  |
| `enter` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `exit` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `enter-at` | percentage | 15% |  |
| `duration` | time | 600ms |  |
| `delay` | time | 0ms |  |
| `ease` | standard in out linear | standard |  |
| `replay` | boolean | false |  |
| `motion` | always | none | spec §13 rule 3; emits a resolve warning |
| `stagger` | time | 80ms |  |

### \sidebar  — spec §11.10

class: block · body: required (block)
children: #paragraph title figure
at most once: title

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | none | not responsive; auto-generated when omitted |
| `cols` | range | none | defaults to the grid's body range |
| `rows` | range | all | screen scenes only |
| `top` | auto or length | auto | flow scenes only |
| `height` | auto or length | auto |  |
| `bleed` | none left right both | none |  |
| `max-width` | fluid or length | none | caps the box width; the box keeps the centre of the space it was given. In a row group: the widest it may grow |
| `min-width` | fluid or length | none | row groups only: the narrowest it may be, rounded up to whole columns |
| `offset-x` | length | 0 |  |
| `offset-y` | length | 0 |  |
| `layer` | background content overlay | content |  |
| `z` | integer | none | defaults to source order |
| `hide` | boolean | false |  |
| `side` | full left right center | full | anchored objects; spec §11.3. center: centred in the column, text on both sides where the gap is wide enough |
| `width` | length | none | anchored objects with side=left|right, % of the column; in a row group, a fixed width rounded to whole columns |
| `wrap` | none rect contour jump | none | default depends on placement mode: rect when anchored with side=left|right or cols, jump for side=full, none when grid-placed |
| `wrap-side` | both left right largest | largest |  |
| `wrap-offset` | length | 1bl |  |
| `enter` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `exit` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `enter-at` | percentage | 15% |  |
| `duration` | time | 600ms |  |
| `delay` | time | 0ms |  |
| `ease` | standard in out linear | standard |  |
| `replay` | boolean | false |  |
| `motion` | always | none | spec §13 rule 3; emits a resolve warning |
| `size` | hero wide column small auto | auto | how big the object is on a wide page; auto: the engine chooses |
| `place` | float here top bottom screen | float | float: the best spot near the text; here: where it stands in the text |
| `style` | ident | none |  |
| `bg` | role or color | none |  |
| `inset` | length | 0 |  |
| `border` | none rule | none |  |
| `portrait` | boolean | false | the widest box, up to its slot, that stays taller than wide |

### \span  — spec §10.2

class: inline · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | required |  |

### \spot  — spec §07.7

class: block · body: none

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `size` | hero wide column small | required | not responsive |
| `place` | top bottom anchor | required | not responsive |
| `span` | integer or range or all all-but-one | 1 | not responsive |
| `side` | left right center | none | not responsive |

### \story  — spec §09.1

class: block · body: required (block)
children: #paragraph kicker headline deck byline meta lede subhead bio blockquote credit dropcap framebreak rule music figure video embed lottie audio gallery pullquote sidebar

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | required | not responsive |
| `overset` | grow clip error | grow |  |
| `style` | ident | body |  |

### \style  — spec §07.6

class: block · body: none

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | required | not responsive |
| `extends` | ident | none | not responsive |
| `at` | ident | none | not responsive |
| `family` | string | none | CSS-style fallback list |
| `weight` | integer | 400 |  |
| `italic` | boolean | false |  |
| `size` | fluid or length | 19px |  |
| `leading` | length | 1bl |  |
| `tracking` | length | 0em |  |
| `case` | none upper lower small-caps | none |  |
| `align` | left right center justify | left |  |
| `color` | role or color | ink |  |
| `indent` | length | 0 |  |
| `space-before` | length | 0 |  |
| `space-after` | length | 1bl |  |
| `hyphenate` | boolean | true |  |
| `widows` | integer | 2 |  |
| `orphans` | integer | 2 |  |
| `keep-with-next` | boolean | false |  |
| `balance` | boolean | false | even lines: the narrowest width that takes no more lines |
| `hyphen-mark` | end both | end | both: a hyphenated word also shows a hyphen where it continues, hanging before the next line |
| `mark` | string | none | a pull quote's decorative mark, set large and bold in the accent above its text |
| `composer` | line paragraph | line | paragraph: each line's break is chosen for the whole paragraph, evening the spacing and keeping a word from standing alone on the last line |
| `hyphenate-min` | integer | 5 | the shortest word, in letters, that hyphenates |
| `hyphenate-caps` | boolean | true | false: a word that starts with a capital never hyphenates |
| `hang` | none quotes punctuation | none | quotation marks (and with punctuation, hyphens, full stops and commas) at a line's edge hang outside the column |
| `bind-short` | boolean | false | a short word (a, the, of, to...) never ends a line: it stays with the word after it |
| `justify-min` | length | none | with align=justify: a line narrower than this is set ragged right instead. Unset: every line justifies |
| `min-slot` | length | none | the narrowest gap beside an object that text is set in; a narrower one stays empty. Unset: 6em of the style's size |
| `features` | string | "liga kern" |  |
| `snap` | baseline none | baseline |  |
| `fit` | none width | none | design 2026-09-22 §5 |
| `fit-max` | length | none | largest fitted size; defaults to three times size |
| `fit-height` | length | none | tallest the fitted paragraph may be |

### \subhead  — spec §10.3

class: block · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | none |  |
| `span` | all | none |  |
| `level` | integer | 1 | 1 renders h2, 2 renders h3 |

### \title  — spec §10.3

class: block · body: required (inline)

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `style` | ident | none |  |
| `span` | all | none |  |

### \token  — spec §07.2

class: block · body: none

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | required | not responsive |
| `value` | any | required | not responsive |

### \video  — spec §11.5

class: block · body: optional (struct)
children: caption credit
at most once: caption credit

| Attribute | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| `name` | ident | none | not responsive; auto-generated when omitted |
| `cols` | range | none | defaults to the grid's body range |
| `rows` | range | all | screen scenes only |
| `top` | auto or length | auto | flow scenes only |
| `height` | auto or length | auto |  |
| `bleed` | none left right both | none |  |
| `max-width` | fluid or length | none | caps the box width; the box keeps the centre of the space it was given. In a row group: the widest it may grow |
| `min-width` | fluid or length | none | row groups only: the narrowest it may be, rounded up to whole columns |
| `offset-x` | length | 0 |  |
| `offset-y` | length | 0 |  |
| `layer` | background content overlay | content |  |
| `z` | integer | none | defaults to source order |
| `hide` | boolean | false |  |
| `side` | full left right center | full | anchored objects; spec §11.3. center: centred in the column, text on both sides where the gap is wide enough |
| `width` | length | none | anchored objects with side=left|right, % of the column; in a row group, a fixed width rounded to whole columns |
| `wrap` | none rect contour jump | none | default depends on placement mode: rect when anchored with side=left|right or cols, jump for side=full, none when grid-placed |
| `wrap-side` | both left right largest | largest |  |
| `wrap-offset` | length | 1bl |  |
| `enter` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `exit` | none fade rise drop slide-left slide-right zoom wipe | none |  |
| `enter-at` | percentage | 15% |  |
| `duration` | time | 600ms |  |
| `delay` | time | 0ms |  |
| `ease` | standard in out linear | standard |  |
| `replay` | boolean | false |  |
| `motion` | always | none | spec §13 rule 3; emits a resolve warning |
| `size` | hero wide column small auto | auto | how big the object is on a wide page; auto: the engine chooses |
| `place` | float here top bottom screen | float | float: the best spot near the text; here: where it stands in the text |
| `shape` | rect circle ellipse alpha or poly | rect |  |
| `clip` | boolean | false |  |
| `alpha-threshold` | percentage | 50% | only with shape=alpha |
| `caption-side` | below above overlay | below |  |
| `src` | path | required |  |
| `poster` | path | none | missing poster on a non-background video is a warning |
| `alt` | string | none |  |
| `captions` | path | none | .vtt |
| `play` | manual visible auto | manual |  |
| `loop` | boolean | false |  |
| `muted` | boolean | false |  |
| `controls` | boolean | true | defaults to false when layer=background |
| `ratio` | ratio | auto |  |
| `fit` | cover contain fill none | cover |  |
| `focus` | pair(percentage) | "50% 50%" |  |

