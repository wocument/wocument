/**
 * Phase B: shaping -- grammar §05.
 *
 * Walks the surface tree top-down. For each command it looks up the schema row
 * and applies that row's body arity and body kind, types every attribute, and
 * validates children. Errors accumulate: a bad command never stops its
 * siblings from being checked.
 */

import {
  COMMANDS,
  COMMAND_NAMES,
  INLINE_CLASS_NAMES,
  PARAGRAPH,
  type AttrSchema,
  type CommandSchema,
} from "@wmxdsl/schema";
import { ROOT_ID, type Attr, type Command, type IdGen, type Inline, type Node, type NodeId, type Trivia } from "./ast.js";
import type { RawAttr } from "./attrs.js";
import { didYouMean, type Diagnostics } from "./diagnostics.js";
import { parseInline, type InlineItem } from "./inline.js";
import type { PositionIndex } from "./positions.js";
import type { SBlank, SComment, SCommand, SurfaceNode } from "./surface.js";
import { describeTypes, typeValue } from "./values.js";

export type ShapeContext = {
  text: string;
  index: PositionIndex;
  diags: Diagnostics;
  ids: IdGen;
  trivia: Trivia[];
};

/** A body kind for content that is not inside any command (document root). */
export type RootKind = "block";

/**
 * Shapes a list of surface nodes as a `block` body. Used for the document
 * root; phase C then classifies what it produced.
 */
export function shapeRoot(ctx: ShapeContext, nodes: readonly SurfaceNode[]): Node[] {
  return shapeBlock(ctx, nodes, null, ROOT_ID);
}

/**
 * Collects comments and blank marks for one body and resolves where each one
 * attaches (grammar §03.2 rule 7).
 *
 * Trivia attaches to the *following* node, so a trivium is only claimed by a
 * node that starts after it ends -- a comment sitting inside a paragraph
 * already in progress is not "followed by" that paragraph. Whatever is left
 * when the body ends attaches to the enclosing command with placement
 * `end-of-body`, or to the document root (id 0) at top level. `attachTo`
 * therefore always names a node that exists.
 */
class TriviaSink {
  private pending: (SComment | SBlank)[] = [];

  constructor(
    private readonly ctx: ShapeContext,
    private readonly ownerId: NodeId,
  ) {}

  record(n: SComment | SBlank): void {
    this.pending.push(n);
  }

  /** Claims everything that ends before `startOffset` for `id`. */
  claim(id: NodeId, startOffset: number): void {
    if (this.pending.length === 0) return;
    const keep: (SComment | SBlank)[] = [];
    for (const n of this.pending) {
      if (n.end <= startOffset) this.emit(n, id, n.kind === "comment" && !n.whole ? "trailing" : "before");
      else keep.push(n);
    }
    this.pending = keep;
  }

  finish(): void {
    for (const n of this.pending) this.emit(n, this.ownerId, "end-of-body");
    this.pending = [];
  }

  private emit(n: SComment | SBlank, attachTo: NodeId, placement: Trivia["placement"]): void {
    this.ctx.trivia.push({
      type: n.kind,
      text: this.ctx.text.slice(n.start, n.end),
      attachTo,
      placement,
      source: this.ctx.index.span(n.start, n.end),
    });
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function shapeCommand(ctx: ShapeContext, node: SCommand, parent: CommandSchema | null): Command | null {
  const { diags, index } = ctx;
  const namePos = index.span(node.start, node.nameEnd);
  const schema = COMMANDS.get(node.name);

  if (schema === undefined) {
    diags.add("P012", namePos, { name: node.name }, didYouMean(node.name, COMMAND_NAMES));
    return null;
  }

  const cmd: Command = {
    kind: "command",
    id: ctx.ids.take(),
    name: node.name,
    attrs: shapeAttrs(ctx, node, schema),
    body: null,
    source: index.span(node.start, node.end < 0 ? node.start : node.end),
  };

  // --- body arity (grammar §05.1) ------------------------------------------
  const hasBody = node.body !== null;
  if (schema.arity === "none" && hasBody) {
    diags.add("P017", namePos, { command: node.name });
  } else if (schema.arity === "required" && !hasBody) {
    diags.add("P018", namePos, { command: node.name });
  }

  // --- cross-field rules ----------------------------------------------------
  runRules(ctx, node, cmd, schema, hasBody, namePos);

  if (!hasBody || schema.arity === "none") return cmd;
  const body = node.body as SurfaceNode[];

  switch (schema.kind) {
    case "struct":
      cmd.body = shapeStruct(ctx, body, schema, cmd.id);
      break;
    case "inline": {
      const runs = shapeInline(ctx, body, schema, cmd.id);
      if (runs.length === 0) diags.add("P019", namePos, { command: node.name });
      cmd.body = runs;
      break;
    }
    case "block":
      cmd.body = shapeBlock(ctx, body, schema, cmd.id);
      break;
    case "scene": {
      const nodes = shapeBlock(ctx, body, schema, cmd.id);
      cmd.body = nodes;
      cmd.sceneForm = classifyScene(ctx, nodes, node);
      break;
    }
    case null:
      break;
  }

  void parent;
  return cmd;
}

function runRules(
  ctx: ShapeContext,
  node: SCommand,
  cmd: Command,
  schema: CommandSchema,
  hasBody: boolean,
  namePos: ReturnType<PositionIndex["span"]>,
): void {
  if (schema.rules.length === 0) return;
  const keys = new Set(cmd.attrs.map((a) => a.key));
  const enumValue = (k: string): string | undefined => {
    const a = cmd.attrs.find((x) => x.key === k && x.at === null);
    return a !== undefined && (a.value.t === "enum" || a.value.t === "ident") ? a.value.id : undefined;
  };
  for (const rule of schema.rules) {
    const hit = rule.check({ keys, enumValue, hasBody });
    if (hit === null) continue;
    const at = cmd.attrs.find((a) => a.key === hit.key);
    const pos = at?.source ?? namePos;
    if (rule.code === "P044") ctx.diags.add("P044", pos);
    else if (rule.code === "P016") ctx.diags.add("P016", namePos, { command: node.name, key: hit.key });
    else ctx.diags.add("P015", pos, { key: hit.key, expected: hit.message });
  }
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

function shapeAttrs(ctx: ShapeContext, node: SCommand, schema: CommandSchema): Attr[] {
  const { diags, index } = ctx;
  const out: Attr[] = [];
  const raws: readonly RawAttr[] = node.attrs?.attrs ?? [];
  const keys = Object.keys(schema.attrs);

  for (const raw of raws) {
    const pos = index.span(raw.keyStart, raw.keyEnd);
    const decl = schema.attrs[raw.key];
    if (decl === undefined) {
      diags.add("P013", pos, { key: raw.key, command: node.name }, didYouMean(raw.key, keys, "`", "`"));
      continue;
    }
    if (raw.at !== null && decl.responsive === false) {
      diags.add("P013", pos, { key: raw.key, why: "nonresponsive" }, "This attribute cannot vary by breakpoint.");
      continue;
    }
    const valuePos =
      raw.value.kind === "absent" ? pos : index.span(raw.value.start, raw.value.end);
    const typed = typeValue(raw.value, decl);
    if (!typed.ok) {
      diags.add("P015", valuePos, { key: raw.key, expected: typed.expected });
      continue;
    }
    out.push({ key: raw.key, at: raw.at, value: typed.value, source: index.span(raw.start, raw.end) });
  }

  // Required attributes (grammar §04.1 rule 4).
  const present = new Set(out.filter((a) => a.at === null).map((a) => a.key));
  for (const [key, decl] of Object.entries(schema.attrs) as [string, AttrSchema][]) {
    if (decl.required === true && !present.has(key)) {
      ctx.diags.add("P016", index.span(node.start, node.nameEnd), { command: node.name, key });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Body kinds (grammar §05.2)
// ---------------------------------------------------------------------------

/** `struct`: only commands, comments and whitespace. */
function shapeStruct(
  ctx: ShapeContext,
  body: readonly SurfaceNode[],
  schema: CommandSchema,
  ownerId: NodeId,
): Node[] {
  const out: Node[] = [];
  const counts = new Map<string, number>();
  const trivia = new TriviaSink(ctx, ownerId);
  for (const n of body) {
    if (n.kind === "comment" || n.kind === "blank") {
      trivia.record(n);
      continue;
    }
    if (n.kind === "text") {
      if (ctx.text.slice(n.start, n.end).trim().length > 0) {
        ctx.diags.add("P021", ctx.index.span(n.start, n.end), { command: schema.name });
      }
      continue;
    }
    if (n.kind === "escape") {
      ctx.diags.add("P021", ctx.index.span(n.start, n.end), { command: schema.name });
      continue;
    }
    const child = shapeChild(ctx, n, schema, counts);
    if (child !== null) {
      trivia.claim(child.id, n.start);
      out.push(child);
    }
  }
  trivia.finish();
  return out;
}

/** `inline`: one inline sequence. */
function shapeInline(
  ctx: ShapeContext,
  body: readonly SurfaceNode[],
  schema: CommandSchema,
  ownerId: NodeId,
): Inline[] {
  const items: InlineItem[] = [];
  // An inline body holds no child nodes, so nothing can follow a trivium here.
  const trivia = new TriviaSink(ctx, ownerId);
  for (const n of body) {
    switch (n.kind) {
      case "comment":
        trivia.record(n);
        break;
      case "blank":
        trivia.record(n);
        ctx.diags.add("P022", ctx.index.span(n.start, n.end), { command: schema.name });
        break;
      case "text":
        items.push({ kind: "text", start: n.start, end: n.end });
        break;
      case "escape":
        items.push({ kind: "escape", start: n.start, end: n.end, char: n.char });
        break;
      case "command": {
        if (!INLINE_CLASS_NAMES.has(n.name)) {
          if (COMMANDS.has(n.name)) {
            ctx.diags.add("P023", ctx.index.span(n.start, n.nameEnd), { name: n.name, parent: schema.name });
          } else {
            ctx.diags.add(
              "P012",
              ctx.index.span(n.start, n.nameEnd),
              { name: n.name },
              didYouMean(n.name, COMMAND_NAMES),
            );
          }
          break;
        }
        const cmd = shapeCommand(ctx, n, schema);
        if (cmd !== null) items.push({ kind: "command", node: cmd, start: n.start, end: n.end });
        break;
      }
    }
  }
  trivia.finish();
  return parseInline(ctx.text, items, ctx.diags, ctx.index);
}

/** `block`: paragraphs interleaved with block nodes (grammar §05.2 rules 1-5). */
function shapeBlock(
  ctx: ShapeContext,
  body: readonly SurfaceNode[],
  schema: CommandSchema | null,
  ownerId: NodeId,
): Node[] {
  const out: Node[] = [];
  const counts = new Map<string, number>();
  const trivia = new TriviaSink(ctx, ownerId);
  let pending: InlineItem[] = [];
  let pendingStart = -1;
  let pendingEnd = -1;
  /**
   * True when an odd number of unescaped backticks has been seen in the
   * paragraph so far, i.e. a code span is open. Grammar §05.4 rule 2 requires
   * P033 for a command inside a code span, which can only happen if the block
   * splitter leaves the command in the paragraph instead of ending it there
   * (vector 20). Escapes are separate surface nodes, so counting characters
   * in text slices gives the right parity.
   */
  let insideCodeSpan = false;

  const endParagraph = (): void => {
    insideCodeSpan = false;
    if (pending.length === 0) {
      pendingStart = -1;
      return;
    }
    const runs = parseInline(ctx.text, pending, ctx.diags, ctx.index);
    if (runs.length > 0) {
      const para: Node = {
        kind: "paragraph",
        id: ctx.ids.take(),
        runs,
        source: ctx.index.span(pendingStart, pendingEnd),
      };
      trivia.claim(para.id, pendingStart);
      out.push(para);
    }
    pending = [];
    pendingStart = -1;
    pendingEnd = -1;
  };

  const addItem = (item: InlineItem): void => {
    if (pendingStart < 0) pendingStart = item.start;
    pendingEnd = item.end;
    pending.push(item);
  };

  for (const n of body) {
    switch (n.kind) {
      case "comment":
        trivia.record(n);
        break;
      case "blank":
        // Rule 1: a blank mark ends the paragraph in progress. The paragraph
        // is closed first, so the blank attaches forward, not backward.
        endParagraph();
        trivia.record(n);
        break;
      case "text":
        // Rule 4. Whitespace-only text between two block nodes makes no paragraph.
        if (pending.length === 0 && ctx.text.slice(n.start, n.end).trim().length === 0) break;
        for (const ch of ctx.text.slice(n.start, n.end)) {
          if (ch === "`") insideCodeSpan = !insideCodeSpan;
        }
        addItem({ kind: "text", start: n.start, end: n.end });
        break;
      case "escape":
        addItem({ kind: "escape", start: n.start, end: n.end, char: n.char });
        break;
      case "command": {
        const known = COMMANDS.get(n.name);
        if (insideCodeSpan) {
          // Leave it in the paragraph so the inline parser can report P033.
          const cmd = shapeCommand(ctx, n, schema);
          if (cmd !== null) addItem({ kind: "command", node: cmd, start: n.start, end: n.end });
          break;
        }
        if (known !== undefined && known.class === "inline") {
          // Rule 3: an inline-class command joins the paragraph in progress.
          const cmd = shapeCommand(ctx, n, schema);
          if (cmd !== null) {
            if (n.name === "endmark" && !allowsParagraphs(schema)) {
              ctx.diags.add("P020", ctx.index.span(n.start, n.nameEnd), {
                name: n.name,
                parent: schema?.name ?? "the document",
              });
            }
            addItem({ kind: "command", node: cmd, start: n.start, end: n.end });
          }
          break;
        }
        // Rule 2: a block-class command ends the paragraph in progress.
        endParagraph();
        const child = shapeChild(ctx, n, schema, counts);
        if (child !== null) {
          trivia.claim(child.id, n.start);
          out.push(child);
        }
        break;
      }
    }
  }
  endParagraph();
  trivia.finish();
  return out;
}

/** Story content is where `\endmark` is allowed (grammar §06 notes). */
function allowsParagraphs(schema: CommandSchema | null): boolean {
  return schema === null || schema.children.includes(PARAGRAPH);
}

/** Validates a child against the parent's allowed set, then shapes it. */
function shapeChild(
  ctx: ShapeContext,
  n: SCommand,
  schema: CommandSchema | null,
  counts: Map<string, number>,
): Command | null {
  if (schema !== null && COMMANDS.has(n.name) && !schema.children.includes(n.name)) {
    ctx.diags.add(
      "P020",
      ctx.index.span(n.start, n.nameEnd),
      { name: n.name, parent: schema.name },
      `\\${schema.name} allows: ${schema.children.filter((c) => c !== PARAGRAPH).join(", ")}.`,
    );
    return null;
  }
  if (schema !== null && schema.maxOnce.includes(n.name)) {
    const seen = (counts.get(n.name) ?? 0) + 1;
    counts.set(n.name, seen);
    if (seen > 1) {
      ctx.diags.add("P020", ctx.index.span(n.start, n.nameEnd), {
        name: n.name,
        parent: schema.name,
        why: "once",
      });
      return null;
    }
  }
  return shapeCommand(ctx, n, schema);
}

// ---------------------------------------------------------------------------
// Scene form (grammar §05.2)
// ---------------------------------------------------------------------------

const STRUCTURAL = new Set(["frame", "group"]);
const OBJECT_OR_RULE = new Set([
  "figure", "video", "embed", "lottie", "audio", "gallery", "pullquote", "sidebar", "rule",
]);

function classifyScene(ctx: ShapeContext, nodes: readonly Node[], node: SCommand): "explicit" | "shorthand" {
  let hasStructural = false;
  let firstContent: Node | null = null;

  for (const n of nodes) {
    if (n.kind === "paragraph") {
      firstContent ??= n;
      continue;
    }
    if (STRUCTURAL.has(n.name)) {
      hasStructural = true;
      continue;
    }
    // A parent's \folio is chrome, not content (§10.5).
    // A \music cue (§10.6) belongs to either form: at a scene's top in one, in the story in the other.
    if (OBJECT_OR_RULE.has(n.name) || n.name === "folio" || n.name === "music") continue;
    // A text element, \dropcap or \framebreak: story content.
    firstContent ??= n;
  }

  if (hasStructural) {
    if (firstContent !== null) {
      ctx.diags.add(
        "P042",
        firstContent.source,
        {},
        "Move this content into a \\frame, or remove the frames and groups.",
      );
    }
    return "explicit";
  }
  return firstContent !== null ? "shorthand" : "explicit";
}

export { shapeCommand };
