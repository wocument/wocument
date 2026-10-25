/**
 * The editor's preview, in an iframe so the page's styles and listeners are its
 * own. The editor posts each Resolved Document it compiles; this lays it out
 * and renders it, keeping the scroll position. `?motion=on` plays reveals;
 * otherwise they are off, so the page does not re-animate on every keystroke.
 */
import type { ResolvedDocument } from "@wocument/resolved-document";
import { createView } from "./view.js";

const report = (e: unknown): void => parent.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) }, location.origin);
const view = createView(document.getElementById("woc")!, {
  reduceMotion: new URLSearchParams(location.search).get("motion") === "on" ? undefined : true,
  onError: report,
});

addEventListener("message", async (e: MessageEvent<{ type: string; rd: ResolvedDocument }>) => {
  if (e.origin !== location.origin || e.data.type !== "show") return;
  const y = scrollY;
  try {
    document.title = e.data.rd.meta.title;
    await view.show(e.data.rd);
    scrollTo(0, y);
  } catch (err) {
    report(err);
  }
});
parent.postMessage({ type: "ready" }, location.origin);
