/**
 * Counts canvas text measurements and attributes them to a phase, to check
 * spec §15.4 point 5 in a real browser: layout must measure nothing; all
 * measuring happens in prepare. Ported from the spike. Must be imported before
 * the text engine asks for a canvas.
 *
 * Both canvas kinds are patched, at getContext time: Pretext prefers an
 * OffscreenCanvas, and it binds measureText once, so patching the prototype's
 * measureText would never be seen.
 */
type Phase = "idle" | "prepare" | "layout";
let phase: Phase = "idle";
const counts = { prepare: 0, layout: 0, idle: 0 };

function patch(proto: { getContext?: unknown } | undefined): void {
  if (!proto || typeof proto.getContext !== "function") return;
  const original = proto.getContext as (...a: unknown[]) => unknown;
  proto.getContext = function (this: unknown, ...args: unknown[]) {
    const ctx = original.apply(this, args) as { measureText?: (t: string) => unknown } | null;
    if (ctx && typeof ctx.measureText === "function") {
      const measure = ctx.measureText.bind(ctx);
      ctx.measureText = (t: string) => {
        counts[phase]++;
        return measure(t);
      };
    }
    return ctx;
  };
}
patch(globalThis.HTMLCanvasElement?.prototype);
patch((globalThis as { OffscreenCanvas?: { prototype: { getContext?: unknown } } }).OffscreenCanvas?.prototype);

export const counter = {
  counts,
  during<T>(p: Phase, f: () => T): T {
    const prev = phase;
    phase = p;
    try {
      return f();
    } finally {
      phase = prev;
    }
  },
};
