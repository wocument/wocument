/// <reference types="vite/client" />
/**
 * The playground page: `?doc=name` picks a document from
 * packages/playground/docs or the parser fixtures and shows it (view.ts).
 */
import "./purity.js";
import type { ResolvedDocument } from "@wmxdsl/resolved-document";
import { createView } from "./view.js";

type Loader = () => Promise<{ default: ResolvedDocument }>;
const found = {
  ...import.meta.glob<{ default: ResolvedDocument }>("../../parser/test/fixtures/*.wmx"),
  ...import.meta.glob<{ default: ResolvedDocument }>("../docs/*.wmx"),
};
const docs = new Map<string, Loader>(Object.entries(found).map(([path, load]) => [path.split("/").pop()!.replace(".wmx", ""), load]));
const params = new URLSearchParams(location.search);
const name = params.get("doc") ?? "showcase";
/** `?motion=reduce` previews the reduced-motion rendering (spec §13 rule 3) without changing the OS setting. */
const reduceMotion = params.get("motion") === "reduce" ? true : undefined;
const root = document.getElementById("page")!;
const svh = document.getElementById("svh")!;

function fail(e: unknown): void {
  // The plain reading version (if the page was served with one) stays, now visible (spec §13 rule 2).
  document.documentElement.classList.remove("wmx-js");
  root.querySelector("pre")?.remove();
  const pre = document.createElement("pre");
  pre.style.cssText = "margin:24px;padding:16px;background:#fee;color:#900;white-space:pre-wrap;font:14px monospace";
  pre.textContent = `${name}: ${e instanceof Error ? e.message : String(e)}\n\nDocuments: ${[...docs.keys()].join(", ")}`;
  root.prepend(pre);
}

try {
  const load = docs.get(name);
  if (!load) throw new Error("no such document");
  const rd = (await load()).default;
  document.title = rd.meta.title;
  await createView(root, svh, { reduceMotion, onError: fail }).show(rd);
} catch (e) {
  fail(e);
}
