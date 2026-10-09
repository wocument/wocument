/**
 * The guarantees in resolved-document.schema.md §3 that JSON Schema cannot
 * express: cross-references, cross-variant shape, and lossless JSON.
 *
 * Returns every violation as a message; an empty list means the document holds.
 * The resolver's snapshot tests should run this on every fixture.
 */

import type { Asset, Block, ObjectElement, ResolvedDocument, Run, Variant } from "./resolved-document.js";

export function checkInvariants(doc: ResolvedDocument): string[] {
  const errors: string[] = [];
  const fail = (m: string): void => void errors.push(m);

  // G1: lossless JSON round trip (no undefined, NaN, Infinity, functions, cycles).
  try {
    if (JSON.stringify(JSON.parse(JSON.stringify(doc))) !== JSON.stringify(doc)) fail("G1: does not round-trip through JSON");
    if (!allFinite(doc)) fail("G1: contains a non-finite number");
  } catch (e) {
    fail(`G1: not serializable: ${String(e)}`);
  }

  // G2: breakpoint cover is sorted, total from 0, and names existing variants.
  const bps = doc.breakpoints;
  if (bps[0]?.minWidth !== 0) fail("G2: first breakpoint range must start at 0");
  for (let i = 1; i < bps.length; i++) {
    if (bps[i]!.minWidth <= bps[i - 1]!.minWidth) fail(`G2: breakpoints not strictly ascending at ${i}`);
    if (bps[i]!.variant === bps[i - 1]!.variant) fail(`G2: adjacent ranges ${i - 1} and ${i} name the same variant`);
  }
  for (const r of bps) if (!(r.variant in doc.variants)) fail(`G2: range names missing variant "${r.variant}"`);

  const str = (s: number, where: string): void => {
    if (!Number.isInteger(s) || s < 0 || s >= doc.strings.length) fail(`G3: ${where}: string index ${s} out of range`);
  };
  const asset = (id: string, kind: Asset["kind"], where: string): void => {
    if (doc.assets[id]?.kind !== kind) fail(`G3: ${where}: asset "${id}" missing or not ${kind}`);
  };

  if (doc.meta.socialImage !== null) asset(doc.meta.socialImage, "image", "meta.socialImage");

  const shapes = new Map<string, string>(); // named story -> block shape, compared across variants

  for (const [name, v] of Object.entries(doc.variants)) {
    const at = (m: string): string => `[${name}] ${m}`;
    if (v.name !== name) fail(at(`G2: variant keyed "${name}" is named "${v.name}"`));

    // G4: exactly the referenced style keys exist.
    const used = new Set<string>();
    const useStyle = (k: string, where: string): void => {
      used.add(k);
      if (!(k in v.styles)) fail(at(`G4: ${where}: style "${k}" not in table`));
    };

    for (const [sid, story] of Object.entries(v.stories)) {
      if (story.id !== sid) fail(at(`G3: story keyed "${sid}" has id "${story.id}"`));
      story.blocks.forEach((b, i) => {
        const where = `${sid}[${i}]`;
        if (b.kind === "paragraph") {
          useStyle(b.style, where);
          if (b.dropcap) (str(b.dropcap.s, where), useStyle(b.dropcap.style, where));
          for (const r of b.runs) checkRun(r, b.links.length, where);
        } else if (b.kind === "object") {
          const o = v.objects[b.object];
          if (!o) fail(at(`G3: ${where}: anchored object "${b.object}" missing`));
          else if (o.placement.mode !== "anchored" || o.placement.story !== sid || o.placement.block !== i)
            fail(at(`G5: ${where}: object "${b.object}" does not point back to this block`));
        }
      });
      if (story.origin === "named") {
        const shape = JSON.stringify(story.blocks.map(blockShape));
        const prev = shapes.get(sid);
        if (prev === undefined) shapes.set(sid, shape);
        else if (prev !== shape) fail(at(`G6: story "${sid}" has a different block list than in another variant`));
      }
    }

    function checkRun(r: Run, links: number, where: string): void {
      if (r.kind === "break") return;
      str(r.s, where);
      useStyle(r.style, where);
      if (r.kind === "text" && r.link !== null && (r.link < 0 || r.link >= links)) fail(at(`G3: ${where}: link ${r.link} out of range`));
    }

    // Frames and objects.
    for (const [fid, f] of Object.entries(v.frames)) {
      if (f.id !== fid) fail(at(`G3: frame keyed "${fid}" has id "${f.id}"`));
      if (!(f.story in v.stories)) fail(at(`G3: frame "${fid}" shows missing story "${f.story}"`));
      if (!v.scenes.some((s) => s.id === f.scene)) fail(at(`G3: frame "${fid}" in missing scene "${f.scene}"`));
    }
    for (const [oid, o] of Object.entries(v.objects)) {
      if (o.id !== oid) fail(at(`G3: object keyed "${oid}" has id "${o.id}"`));
      checkObject(o, v, at, asset, fail);
      if (o.placement.mode === "contained") {
        const c = v.objects[o.placement.container];
        const list = c?.kind === "gallery" ? c.items : c?.kind === "group" ? c.children.map((x) => x.id) : null;
        if (list?.[o.placement.index] !== oid) fail(at(`G5: object "${oid}" is not child ${o.placement.index} of "${o.placement.container}"`));
      }
      if ("caption" in o && o.caption && !(o.caption.story in v.stories)) fail(at(`G3: object "${oid}" caption story missing`));
      if ((o.kind === "pullquote" || o.kind === "sidebar") && !(o.story in v.stories)) fail(at(`G3: object "${oid}" story missing`));
    }
    for (const s of v.scenes) {
      if (s.folio && !(s.folio.story in v.stories)) fail(at(`G3: scene "${s.id}" folio story "${s.folio.story}" missing`));
      for (const c of s.children) {
        const hit = c.kind === "frame" ? v.frames[c.id] : v.objects[c.id];
        if (!hit) fail(at(`G3: scene "${s.id}" child ${c.kind} "${c.id}" missing`));
      }
    }

    // G7: threads list exactly the visible frames of each story, in scene order then source order.
    const order = frameOrder(v);
    for (const fid of Object.keys(v.frames)) if (!order.includes(fid)) fail(at(`G3: frame "${fid}" is in no scene`));
    const expected = new Map<string, string[]>();
    for (const fid of order) {
      const f = v.frames[fid]!;
      if (!f.hidden) expected.set(f.story, [...(expected.get(f.story) ?? []), fid]);
    }
    for (const [sid, frames] of Object.entries(v.threads)) {
      if (JSON.stringify(frames) !== JSON.stringify(expected.get(sid) ?? []))
        fail(at(`G7: thread "${sid}" is ${JSON.stringify(frames)}, expected ${JSON.stringify(expected.get(sid) ?? [])}`));
    }
    for (const sid of expected.keys()) if (!(sid in v.threads)) fail(at(`G7: story "${sid}" has visible frames but no thread`));
    for (const [sid, story] of Object.entries(v.stories)) {
      if (story.origin === "named" && (v.threads[sid]?.length ?? 0) === 0) fail(at(`G7: story "${sid}" has no visible frame`));
    }

    for (const k of Object.keys(v.styles)) if (!used.has(k)) fail(at(`G4: style "${k}" is never referenced`));
  }

  // G2, continued: every variant other than base is selected by some range.
  const named = new Set(bps.map((r) => r.variant));
  for (const n of Object.keys(doc.variants)) if (n !== "base" && !named.has(n)) fail(`G2: variant "${n}" is selected by no range`);

  return errors;
}

function checkObject(
  o: ObjectElement,
  v: Variant,
  at: (m: string) => string,
  asset: (id: string, kind: Asset["kind"], where: string) => void,
  fail: (m: string) => void,
): void {
  const w = at(`object "${o.id}"`);
  switch (o.kind) {
    case "figure":
      asset(o.image, "image", w);
      if (o.motionVideo) asset(o.motionVideo, "video", w);
      break;
    case "video":
      asset(o.video, "video", w);
      if (o.poster) asset(o.poster, "image", w);
      if (o.captions) asset(o.captions, "file", w);
      break;
    case "lottie":
      asset(o.lottie, "lottie", w);
      break;
    case "audio":
      asset(o.audio, "audio", w);
      if (o.captions) asset(o.captions, "file", w);
      if (o.transcript) asset(o.transcript, "file", w);
      break;
    case "embed":
      if (o.poster && "asset" in o.poster) asset(o.poster.asset, "image", w);
      break;
    case "gallery":
      for (const id of o.items) if (!v.objects[id]) fail(`G3: ${w}: gallery item "${id}" missing`);
      break;
    default:
      break;
  }
  if ("media" in o && o.media.shape.kind === "polygon") asset(o.media.shape.polygon, "polygon", w);
}

/** Frames in thread order: scenes in order, then each scene's children depth-first in source order. */
function frameOrder(v: Variant): string[] {
  const out: string[] = [];
  const walk = (kind: "frame" | "object", id: string): void => {
    if (kind === "frame") out.push(id);
    else {
      const o = v.objects[id];
      if (o?.kind === "group") for (const c of o.children) walk(c.kind, c.id);
    }
  };
  for (const s of v.scenes) for (const c of s.children) walk(c.kind, c.id);
  return out;
}

/** Shape of a block for the cross-variant comparison: kind and anchor target, not per-breakpoint properties. */
function blockShape(b: Block): string {
  return b.kind === "object" ? `object:${b.object}` : b.kind === "framebreak" ? `framebreak:${b.scope}` : b.kind;
}

function allFinite(x: unknown): boolean {
  if (typeof x === "number") return Number.isFinite(x);
  if (Array.isArray(x)) return x.every(allFinite);
  if (x !== null && typeof x === "object") return Object.values(x).every(allFinite);
  return true;
}
