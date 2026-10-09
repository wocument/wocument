# @wmxdsl/parser

Hand-written parser for WMXDSL. Turns a `.wmx` document or a `.wmxt` theme file
into a validated AST plus a list of diagnostics.

Normative sources: `wmxdsl-grammar.md` for syntax, `wmxdsl-specification.md`
for attribute names, types, defaults and meaning. Where they disagree on
syntax, the grammar wins.

## Running it

From the repository root:

```sh
npm install
npm test                 # the whole suite
npm run typecheck        # tsc over src, tests and scripts
npm run build            # emit dist/ for both packages
npm run print-tables     # spec-style attribute table for every command
npm run print-tables -- figure video    # or just these
```

`print-tables` exists so a human can diff the schema data against the
specification tables. Run it whenever a command row changes.

## Public API

```ts
import { parse, parseSurface } from "@wmxdsl/parser";

const result = parse(source, { file: "castle.wmx", kind: "document" });
//    ^ { ast: Document | Theme | null, diagnostics: Diagnostic[], ok: boolean }
```

- `input` is a `string` or a `Uint8Array`. Bytes are validated as UTF-8 and
  produce `L001` on failure; strings skip that check.
- `kind` is `"document"` (default) or `"theme"`.
- `ast` is `null` only when phase A0 or phase A could not produce a tree.
- `ok` is true when there are no errors. Warnings do not clear it.

Every diagnostic carries a stable code, a severity, a message, a 1-based
position counted in **Unicode code points**, and a fix hint where one exists.

```ts
parseSurface(text); // { nodes: SurfaceNode[], diagnostics: Diagnostic[] }
```

The lower-level entry point. It knows nothing about command names, so syntax
highlighters and the future formatter can use it directly and stay correct when
commands are added.

**Guarantees.** The parser never throws on bad input — a throw means a
programmer error, such as bad options. It is a pure function: no DOM, no file
system, no network, no clocks, no randomness. The same source always gives the
same AST and the same diagnostics, in Node and in a browser worker. The only
runtime dependency is `yaml`, used for frontmatter.

## Adding a command

Add a schema row. Nothing else.

```ts
// packages/schema/src/commands/text.ts
export const ASIDE = inlineEl("aside", "§10.3");

// packages/schema/src/commands/registry.ts — add it to the family array
```

The row carries the body arity and kind, the allowed children, the attributes
with their types and defaults, and any cross-field rules. Shared attribute
groups (placement, wrap, shape, reveal) live in `commands/groups.ts` and are
mixed in. If a new command needs parser code, the design is wrong.

Then: a row in the specification table, and — for anything that changes syntax
— a grammar edit plus a conformance vector.

## How it is put together

| Phase | Module | Knows the schema? |
| :---- | :---- | :---- |
| A0 prepare | `prepare.ts` | no |
| A surface | `surface.ts`, `attrs.ts` | no |
| B shape | `shape.ts`, `values.ts`, `inline.ts` | yes |
| C document | `document.ts` | yes |

Phase A is a small fixed grammar that never changes when commands are added.
Only phase B looks commands up.

Three things are worth knowing before changing any of it:

- **Positions count code points.** `positions.ts` indexes surrogate pairs once
  and subtracts them with a binary search, so an offset resolves in O(log n)
  and a 50,000-character line cannot go quadratic.
- **Body nesting is iterative.** The surface scanner uses an explicit stack, so
  depth is bounded by memory rather than the call stack.
- **The link lookahead is precomputed.** Code-span extents and bracket pairs
  are each matched in one linear pass before the inline scan, which is what
  keeps a paragraph of 50,000 `[` characters linear.

## Test layout

```
test/conformance/   the vectors of grammar §13 (1-42)
test/diagnostics/   one golden test per code in grammar §11
test/fixtures/      the five articles from the documents, plus AST snapshots
test/unit/          positions, prepare, values, fuzzing, performance, nesting
```

The fixtures are extracted verbatim from spec §18 and stress test §01 to §03.
All five must parse with zero diagnostics; the warnings those documents mention
(missing `alt`, linearize, `snap=hard` on a flow scene) belong to the resolver.

## Not in this package

Tolerant mode for editors (grammar §10), the formatter (grammar §09), and the
resolver — cascade, tokens, inheritance, desugaring, breakpoint existence,
placement validation, quote curling, hyphenation. The AST keeps raw value
spellings and trivia so the formatter can be built on it later.
