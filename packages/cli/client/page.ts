/// <reference types="vite/client" />
/**
 * One document as a page, without the editor: for another window or a phone
 * (`woc dev --host`). `?doc=name` picks it. When its file, or a theme, is
 * saved, the page shows the new version and keeps the scroll position.
 */
import type { ResolvedDocument } from "@wocument/resolved-document";
import { createView } from "./view.js";

type Compiled = { problems: { severity: string; code: string; message: string; line: number }[]; rd: ResolvedDocument | null };

const root = document.getElementById("woc")!;
const names = (await (await fetch("/__woc/docs")).json()) as string[];
const doc = new URLSearchParams(location.search).get("doc") ?? names[0] ?? "";

function fail(message: string): void {
  root.querySelector("pre")?.remove();
  const pre = document.createElement("pre");
  pre.style.cssText = "margin:24px;padding:16px;background:#fee;color:#900;white-space:pre-wrap;font:14px monospace";
  pre.textContent = message;
  root.prepend(pre);
}

const view = createView(root, { onError: (e) => fail(e instanceof Error ? e.message : String(e)) });

async function show(): Promise<void> {
  const res = await fetch(`/__woc/document?doc=${encodeURIComponent(doc)}`);
  if (!res.ok) return fail(`${doc}: no such document in this folder.\n\nDocuments: ${names.join(", ")}`);
  const { problems, rd } = (await res.json()) as Compiled;
  // A document that stops compiling keeps showing its last good version, with the errors above it.
  const errors = problems.filter((p) => p.severity === "error");
  if (!rd) return fail(errors.map((p) => `${p.code} at line ${p.line}: ${p.message}`).join("\n"));
  const y = scrollY;
  document.title = rd.meta.title;
  await view.show(rd);
  scrollTo(0, y);
}

import.meta.hot?.on("woc:change", (data: { doc: string | null }) => {
  if (data.doc === null || data.doc === doc) void show();
});
await show();
