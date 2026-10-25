/**
 * `woc dev`: the server's endpoints. The pages themselves are checked in a browser.
 * Reads the built packages (dist), as the server does: run `npm run build` first.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ViteDevServer } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dev } from "../src/dev.js";

let dir: string;
let server: ViteDevServer | null = null;
let base = "";
const PAGE = { "sec-fetch-site": "same-origin" };

const start = async (target: string): Promise<void> => {
  server = await dev(target, { public: join(dir, "public"), port: 0, host: false, open: false });
  base = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
};
const get = (path: string, headers: Record<string, string> = PAGE) => fetch(base + path, { headers });
const post = (path: string, value: unknown, headers: Record<string, string> = PAGE) => fetch(base + path, { method: "POST", headers, body: JSON.stringify(value) });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "woc-dev-"));
  mkdirSync(join(dir, "public"));
  writeFileSync(join(dir, "clip.mp4"), Buffer.from("0123456789"));
  writeFileSync(join(dir, "a.woc"), "---\nwocument: 1\ntitle: A\n---\n\\headline{A}\n\nText.\n\n\\video[src=./clip.mp4, alt=\"A clip\", poster=./none.jpg]\n");
});
afterEach(async () => {
  await server?.close();
  server = null;
});

describe("woc dev", () => {
  it("lists the folder's documents, to the dev pages only", async () => {
    await start(dir);
    expect(await (await get("/__woc/docs")).json()).toEqual(["a"]);
    expect((await get("/__woc/docs", {})).status).toBe(403);
    expect((await get("/__woc/docs", { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  it("a new .woc file starts from the template", async () => {
    await start(join(dir, "new.woc"));
    expect(readFileSync(join(dir, "new.woc"), "utf8")).toContain("\\headline{Untitled}");
    expect(await (await get("/__woc/docs")).json()).toEqual(["a", "new"]);
  });

  it("serves a document resolved, and the files it uses by name, with byte ranges", async () => {
    await start(dir);
    const { rd, problems } = await (await get("/__woc/document?doc=a")).json();
    expect(rd.format).toBe("wocument-resolved");
    expect(problems.map((p: { code: string }) => p.code)).toContain("W050"); // the poster is missing
    const url = (Object.values(rd.assets) as { kind: string; sources?: { url: string }[] }[]).find((a) => a.kind === "video")!.sources![0]!.url;
    expect(url).toMatch(/^\/__woc\/files\/clip-[0-9a-f]{10}\.mp4$/);
    const whole = await get(url, {});
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(await whole.text()).toBe("0123456789");
    const part = await get(url, { range: "bytes=2-4" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await part.text()).toBe("234");
    expect((await get("/__woc/files/other-0000000000.mp4", {})).status).toBe(404);
  });

  it("compiles unsaved text and reports errors where they are", async () => {
    await start(dir);
    const r = await (await post("/__woc/compile", { source: "---\nwocument: 1\ntitle: T\n---\n\\headlin{x}\n", doc: "a" })).json();
    expect(r.rd).toBeNull();
    expect(r.problems[0]).toMatchObject({ severity: "error", line: 5, column: 1 });
  });

  it("saves only documents that exist in the folder", async () => {
    await start(dir);
    const source = "---\nwocument: 1\ntitle: B\n---\nSaved.\n";
    expect((await post("/__woc/save", { doc: "a", source })).status).toBe(200);
    expect(readFileSync(join(dir, "a.woc"), "utf8")).toBe(source);
    expect((await post("/__woc/save", { doc: "../a", source })).status).toBe(404);
    expect((await post("/__woc/save", { doc: "a", source: "x" }, {})).status).toBe(403);
    expect(existsSync(join(dir, "..", "a.woc"))).toBe(false);
  });

  it("refuses a path that is neither a folder nor a .woc file", async () => {
    await expect(dev(join(dir, "nothing"), { public: dir, port: 0, host: false, open: false })).rejects.toThrow("is not a folder or a .woc file");
  });
});
