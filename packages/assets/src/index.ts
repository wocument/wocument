/**
 * @wmxdsl/assets -- the build-time asset host the resolver calls for media
 * (spec §11.4-§11.9, §12.2). Node only: it reads files. The resolver stays
 * pure and sees only the `AssetHost` interface it defines.
 *
 * WebP (2026-10-09): with `webp` set, JPEG, PNG and GIF pictures are served as WebP, an
 * animated GIF as an animated WebP, transparency kept. Converting is slow and asynchronous while
 * resolving is not, so the host serves a picture's original until its WebP exists: resolve, await
 * `convert()`, and resolve again when it converted anything. Sizes and contours always come from
 * the original.
 *
 * Limit: responsive image sets (§11.4) are not generated yet: one WebP per
 * picture, at its own size. Alpha contours read PNG only.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, extname, join, resolve as resolvePath } from "node:path";
import sharp from "sharp";
import { imageSize } from "image-size";
import { PNG } from "pngjs";
import type { AssetHost, ContourRequest, ImageInfo } from "@wmxdsl/resolver";
import { cropFor, traceAlpha } from "./contour.js";

export { cropFor, traceAlpha } from "./contour.js";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".vtt": "text/vtt",
  ".json": "application/json",
  ".lottie": "application/zip",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".txt": "text/plain",
  ".html": "text/html",
};

export type HostOptions = {
  /** The directory that site-absolute paths (`/img/a.png`) are served from. */
  publicDir: string;
  /** The directory relative paths (`./a.png`) resolve from: the source file's (spec §06.2). */
  sourceDir: string;
  /** Serve pictures as WebP: converted files go in `dir`, which the page loads from `url`. */
  webp?: { dir: string; url: string };
};

/** Pictures worth converting; SVG, WebP and AVIF are served as they are. */
const CONVERTS = new Set(["image/png", "image/jpeg", "image/gif"]);

export function createAssetHost(opts: HostOptions): AssetHost & { convert(): Promise<number> } {
  const cache = new Map<string, Buffer>();
  const fileOf = (path: string): string =>
    path.startsWith("/") ? join(opts.publicDir, path) : resolvePath(opts.sourceDir, path);
  const read = (path: string): Buffer => {
    let b = cache.get(path);
    if (!b) {
      b = readFileSync(fileOf(path));
      cache.set(path, b);
    }
    return b;
  };
  /** The URL the page loads. Site-absolute paths are served as they are. Limit: relative paths need the build to copy them. */
  const urlOf = (path: string): string => path;
  const typeOf = (path: string): string => TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  /** WebP files still to make: output name to source file. */
  const pending = new Map<string, string>();
  /** The WebP a picture is served as, named by its content so an edited picture converts again; null until it exists. */
  const webpOf = (path: string, bytes: Buffer): string | null => {
    if (!opts.webp || !CONVERTS.has(typeOf(path))) return null;
    const name = `${basename(path, extname(path))}-${createHash("sha1").update(bytes).digest("hex").slice(0, 10)}.webp`;
    if (existsSync(join(opts.webp.dir, name))) return `${opts.webp.url}/${name}`;
    pending.set(name, fileOf(path));
    return null;
  };

  return {
    image(path: string): ImageInfo | null {
      if (!existsSync(fileOf(path))) return null;
      const bytes = read(path);
      const size = imageSize(bytes);
      if (!size.width || !size.height) throw new Error(`cannot read the size of ${path}`);
      // An animated GIF carries the NETSCAPE2.0 looping extension.
      const animated = typeOf(path) === "image/gif" && bytes.includes("NETSCAPE2.0");
      const webp = webpOf(path, bytes);
      return { url: webp ?? urlOf(path), type: webp ? "image/webp" : typeOf(path), width: size.width, height: size.height, animated };
    },

    contour(path: string, req: ContourRequest): [number, number][] | null {
      if (typeOf(path) !== "image/png" || !existsSync(fileOf(path))) return null;
      const png = PNG.sync.read(read(path));
      const alpha = new Uint8Array(png.width * png.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = png.data[i * 4 + 3]!;
      const crop = cropFor(png.width, png.height, req.ratio, req.fit, req.focus);
      return traceAlpha({ width: png.width, height: png.height, alpha }, { threshold: req.threshold, crop });
    },

    file(path: string): { url: string; type: string } | null {
      return existsSync(fileOf(path)) ? { url: urlOf(path), type: typeOf(path) } : null;
    },

    /** Makes the WebP files the last resolve asked for; the number made. Photos at quality 80, transparency kept. */
    async convert(): Promise<number> {
      if (!opts.webp || !pending.size) return 0;
      mkdirSync(opts.webp.dir, { recursive: true });
      const jobs = [...pending];
      pending.clear();
      await Promise.all(jobs.map(([name, src]) => sharp(src, { animated: true }).webp({ quality: 80, alphaQuality: 90 }).toFile(join(opts.webp!.dir, name))));
      return jobs.length;
    },
  };
}
