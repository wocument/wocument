/// <reference types="vite/client" />
/**
 * The live editor: WMX source on the left, the
 * rendered page on the right. On every pause in typing the text goes to the dev
 * server, which parses and resolves it exactly as a saved file would be
 * (vite.config.ts `compile`); the preview iframe lays out and renders the
 * result. A document that stops compiling keeps showing its last good version.
 *
 * Save (or Cmd/Ctrl-S) writes the text back to its .wmx file; until then edits
 * are kept per document in this browser, and Revert goes back to the file.
 * Documents are fetched rather than imported, so a save does not make Vite
 * reload this page.
 */
import type { ResolvedDocument } from "@wmxdsl/resolved-document";

type Problem = { severity: "error" | "warning"; code: string; message: string; line: number; column: number };
type Compiled = { problems: Problem[]; rd: ResolvedDocument | null; formatted: string | null };

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`/__wmx/${path}`, init);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
};
const names = await api<string[]>("docs");

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const code = $<HTMLTextAreaElement>("code");
const gutter = $<HTMLPreElement>("gutter");
const docSelect = $<HTMLSelectElement>("doc");
const status = $<HTMLSpanElement>("status");
const frame = $<HTMLIFrameElement>("frame");
const problemList = $<HTMLUListElement>("problems");
const json = $<HTMLPreElement>("json");
const main = document.querySelector("main")!;
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

let doc = new URLSearchParams(location.search).get("doc") ?? "showcase";
if (!names.includes(doc)) doc = "showcase";
/** The document's text as it is in its file. */
let onDisk = "";
let last: Compiled = { problems: [], rd: null, formatted: null };
/** The text `last` was compiled from. */
let lastSource = "";
/** The last document that compiled, which the preview keeps showing through errors. */
let shown: ResolvedDocument | null = null;
let previewReady = false;

// ---- drafts: per-viewer, so browser storage is enough -----------------------------

const draftKey = (): string => `wmx-editor:${doc}`;
const readDraft = (): string | null => {
  try {
    return localStorage.getItem(draftKey());
  } catch {
    return null;
  }
};
const writeDraft = (text: string | null): void => {
  try {
    if (text === null) localStorage.removeItem(draftKey());
    else localStorage.setItem(draftKey(), text);
  } catch {
    // Storage unavailable: edits simply are not kept across reloads.
  }
};

// ---- source pane ------------------------------------------------------------------

let gutterLines = 0;
function paintGutter(): void {
  const n = code.value.split("\n").length;
  if (n !== gutterLines) gutter.textContent = Array.from({ length: (gutterLines = n) }, (_, i) => i + 1).join("\n");
  gutter.scrollTop = code.scrollTop;
}
code.addEventListener("scroll", () => (gutter.scrollTop = code.scrollTop));

code.addEventListener("keydown", (e) => {
  // Tab indents two spaces (grammar §09 rule 9); Escape then Tab still leaves the field.
  if (e.key !== "Tab" || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  code.setRangeText("  ", code.selectionStart, code.selectionEnd, "end");
  code.dispatchEvent(new Event("input"));
});

function setSource(text: string): void {
  code.value = text;
  paintGutter();
  schedule(0);
}

function goTo(line: number, column: number): void {
  const lines = code.value.split("\n");
  const at = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + Math.max(0, column - 1);
  selectTab("source");
  code.focus();
  code.setSelectionRange(at, at);
  code.scrollTop = Math.max(0, (line - 5) * 20);
}

// ---- compiling ----------------------------------------------------------------------

let timer = 0;
let seq = 0;
function schedule(delay = 250): void {
  clearTimeout(timer);
  timer = window.setTimeout(compileNow, delay);
}

async function compileNow(): Promise<void> {
  const mine = ++seq;
  const source = code.value;
  const started = performance.now();
  status.textContent = "Compiling…";
  let result: Compiled;
  try {
    const res = await fetch("/__wmx/compile", { method: "POST", body: JSON.stringify({ source, doc }) });
    result = (await res.json()) as Compiled;
  } catch (e) {
    result = { problems: [{ severity: "error", code: "server", message: `Could not reach the dev server: ${String(e)}`, line: 1, column: 1 }], rd: null, formatted: null };
  }
  if (mine !== seq) return; // a newer edit is already on its way
  last = result;
  lastSource = source;
  if (result.rd) {
    shown = result.rd;
    sendPreview();
  }
  const errors = result.problems.filter((p) => p.severity === "error").length;
  const warnings = result.problems.length - errors;
  const ms = Math.round(performance.now() - started);
  status.className = errors ? "error" : "";
  status.textContent = errors
    ? `${errors} error${errors === 1 ? "" : "s"}${shown ? ", preview shows the last version that compiled" : ""}`
    : `Compiled in ${ms} ms${warnings ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}`;
  paintProblems();
  if (!$("panel-resolved").hidden) paintJson();
}

function paintProblems(): void {
  const tab = tabs.find((t) => t.dataset.for === "problems")!;
  tab.textContent = last.problems.length ? `Problems (${last.problems.length})` : "Problems";
  problemList.replaceChildren(
    ...(last.problems.length
      ? last.problems.map((p) => {
          const li = document.createElement("li");
          li.tabIndex = 0;
          li.innerHTML = `<span class="${p.severity}"></span><span class="where"></span><span></span>`;
          const [sev, where, msg] = li.children as unknown as HTMLElement[];
          sev!.textContent = p.code;
          where!.textContent = `${p.line}:${p.column}`;
          msg!.textContent = p.message;
          const go = (): void => goTo(p.line, p.column);
          li.addEventListener("click", go);
          li.addEventListener("keydown", (e) => e.key === "Enter" && go());
          return li;
        })
      : [Object.assign(document.createElement("li"), { className: "none", textContent: "No problems." })]),
  );
}

function paintJson(): void {
  json.textContent = last.rd ? JSON.stringify(last.rd, null, 2) : "Nothing resolved: fix the errors first.";
}

// ---- preview ------------------------------------------------------------------------

function sendPreview(): void {
  if (previewReady && shown) frame.contentWindow!.postMessage({ type: "show", rd: shown }, location.origin);
}

function loadPreview(): void {
  previewReady = false;
  frame.src = `/preview.html${$<HTMLInputElement>("motion").checked ? "?motion=on" : ""}`;
}

addEventListener("message", (e: MessageEvent<{ type: string; message?: string }>) => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
  if (e.data.type === "ready") {
    previewReady = true;
    sendPreview();
  } else if (e.data.type === "error") {
    last = { ...last, problems: [...last.problems, { severity: "error", code: "render", message: e.data.message ?? "", line: 1, column: 1 }] };
    paintProblems();
  }
});

$<HTMLSelectElement>("width").addEventListener("change", (e) => {
  const v = (e.target as HTMLSelectElement).value;
  frame.style.width = v === "fit" ? "100%" : `${v}px`;
});
$<HTMLInputElement>("motion").addEventListener("change", loadPreview);

// ---- tabs ---------------------------------------------------------------------------

function selectTab(name: string): void {
  main.dataset.tab = name;
  for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.for === name));
  // On a wide screen the source is always beside the output, so "source" leaves the output tab as it was.
  for (const panel of ["preview", "problems", "resolved"]) {
    if (name !== "source") $(`panel-${panel}`).hidden = panel !== name;
  }
  if (name === "resolved") paintJson();
}
for (const t of tabs) t.addEventListener("click", () => selectTab(t.dataset.for!));

// ---- documents and buttons ------------------------------------------------------------

async function open(name: string): Promise<void> {
  doc = name;
  history.replaceState(null, "", `?doc=${encodeURIComponent(name)}`);
  shown = null;
  onDisk = (await api<{ source: string }>(`source?doc=${encodeURIComponent(name)}`)).source;
  setSource(readDraft() ?? onDisk);
  paintDirty();
}

const saveButton = $<HTMLButtonElement>("save");
function paintDirty(): void {
  const dirty = code.value !== onDisk;
  saveButton.disabled = !dirty;
  saveButton.textContent = dirty ? "Save •" : "Saved";
}

async function save(): Promise<void> {
  if (code.value === onDisk) return;
  const source = code.value;
  try {
    const r = await api<{ saved: string }>("save", { method: "POST", body: JSON.stringify({ doc, source }) });
    onDisk = source;
    if (code.value === source) writeDraft(null);
    status.className = "";
    status.textContent = `Saved ${r.saved}`;
  } catch (e) {
    status.className = "error";
    status.textContent = `Not saved: ${e instanceof Error ? e.message : String(e)}`;
  }
  paintDirty();
}
saveButton.addEventListener("click", () => void save());
addEventListener("keydown", (e) => {
  if (e.key === "s" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    void save();
  }
});

docSelect.append(...names.map((n) => new Option(n, n, false, n === doc)));
docSelect.addEventListener("change", () => void open(docSelect.value));

code.addEventListener("input", () => {
  paintGutter();
  paintDirty();
  writeDraft(code.value === onDisk ? null : code.value);
  schedule();
});

$("format").addEventListener("click", () => {
  if (lastSource !== code.value) {
    status.textContent = "Still compiling; format again in a moment.";
    return;
  }
  if (last.formatted === null) {
    status.textContent = "Fix the errors before formatting.";
    return;
  }
  // Through setRangeText, so the browser's undo can take it back.
  code.focus();
  code.setRangeText(last.formatted, 0, code.value.length, "start");
  code.dispatchEvent(new Event("input"));
});

$("revert").addEventListener("click", async () => {
  if (code.value !== onDisk && !confirm(`Discard your unsaved edits to ${doc}?`)) return;
  writeDraft(null);
  await open(doc);
});

loadPreview();
await open(doc);
