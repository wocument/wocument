/**
 * Draws the playground's demo images, so the showcase has media without
 * shipping third-party photographs. Deterministic: a seeded PRNG, so a rerun
 * gives identical files. PNGs are written with pngjs; the photos are then
 * converted to JPEG with macOS `sips`.
 *
 *   node packages/playground/scripts/make-demo-assets.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

/** A path under public/, e.g. `img/dusk.jpg`; its folder is created. */
const out = (rel) => {
  const path = fileURLToPath(new URL(`../public/${rel}`, import.meta.url));
  mkdirSync(fileURLToPath(new URL(".", `file://${path}`)), { recursive: true });
  return path;
};
/** Writes a PNG canvas as a JPEG at `rel` (without extension). */
const jpeg = (png, rel) => {
  writeFileSync(out(`${rel}.png`), PNG.sync.write(png));
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80", out(`${rel}.png`), "--out", out(`${rel}.jpg`)], { stdio: "ignore" });
  rmSync(out(`${rel}.png`));
};

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

function canvas(w, h) {
  const png = new PNG({ width: w, height: h });
  const set = (x, y, [r, g, b], a = 255) => {
    const i = (y * w + x) * 4;
    png.data[i] = clamp(r);
    png.data[i + 1] = clamp(g);
    png.data[i + 2] = clamp(b);
    png.data[i + 3] = clamp(a);
  };
  return { png, set, w, h };
}

/** A ridge line: a few summed sines, y as a fraction of height. */
const ridge = (base, amp, seed) => {
  const r = rng(seed);
  const waves = Array.from({ length: 4 }, (_, i) => ({ f: (i + 1) * (1 + r()), p: r() * 6.28, a: amp / (i + 1) }));
  return (x) => base + waves.reduce((s, w) => s + w.a * Math.sin(x * w.f * 6.28 + w.p), 0);
};

function landscape(name, { sky, ground, stars, wall, seed = 0, size = [1600, 1000] }) {
  const { png, set, w, h } = canvas(...size);
  const r = rng(7 + seed);
  const hills = [ridge(0.62, 0.05, 1 + seed), ridge(0.7, 0.04, 2 + seed), ridge(0.8, 0.03, 3 + seed)];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fy = y / h;
      const fx = x / w;
      let c = fy < 0.55 ? mix(sky[0], sky[1], fy / 0.55) : mix(sky[1], sky[2], Math.min(1, (fy - 0.55) / 0.2));
      hills.forEach((hill, i) => {
        if (fy > hill(fx)) c = mix(ground[i], [0, 0, 0], (fy - hill(fx)) * 0.6);
      });
      // The wall: a thin pale line riding the first ridge.
      if (wall && Math.abs(fy - (hills[0](fx) - 0.004)) < 0.0022) c = mix(c, wall, 0.85);
      set(x, y, c.map((v) => v + (r() - 0.5) * 6));
    }
  if (stars)
    for (let i = 0; i < 900; i++) {
      const x = Math.floor(r() * w);
      const y = Math.floor(r() * h * 0.55);
      set(x, y, [230, 232, 240], 255 * (0.3 + 0.7 * r()));
    }
  jpeg(png, name.includes("/") ? name : `img/${name}`);
}

function stones() {
  const { png, set, w, h } = canvas(1600, 900);
  const r = rng(11);
  const rowH = 90;
  const blocks = [];
  for (let row = 0; row * rowH < h; row++) {
    let x = -r() * 120;
    while (x < w) {
      const bw = 130 + r() * 110;
      blocks.push({ x, y: row * rowH, w: bw, tone: 150 + r() * 50, moss: r() < 0.15 });
      x += bw;
    }
  }
  for (const b of blocks)
    for (let y = b.y; y < Math.min(h, b.y + rowH); y++)
      for (let x = Math.max(0, Math.floor(b.x)); x < Math.min(w, b.x + b.w); x++) {
        const edge = Math.min(x - b.x, b.x + b.w - x, y - b.y, b.y + rowH - y);
        const mortar = edge < 5;
        const t = b.tone + (r() - 0.5) * 22;
        const c = mortar ? [96, 90, 80] : b.moss && y > b.y + rowH * 0.6 ? [t * 0.6, t * 0.72, t * 0.45] : [t, t * 0.94, t * 0.84];
        set(x, y, c);
      }
  jpeg(png, "img/stones");
}

/** A turret on transparency: tapering walls, crenellations, a doorway, stone courses. */
function tower() {
  const { png, set, w, h } = canvas(700, 1000);
  const r = rng(23);
  const cx = w / 2;
  const halfAt = (y) => 150 + (y / h) * 90; // widens toward the foot
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let inside = Math.abs(x - cx) < halfAt(y) && y > 110;
      // Parapet wider than the shaft, with crenellations on top.
      if (y > 60 && y <= 190 && Math.abs(x - cx) < 205) inside = y > 110 || Math.floor((x - cx + 205) / 50) % 2 === 0;
      // A doorway at the foot.
      if (y > h - 170 && Math.abs(x - cx) < 45 && (y > h - 125 || (x - cx) ** 2 + (y - (h - 125)) ** 2 < 45 ** 2)) inside = false;
      if (!inside) {
        set(x, y, [0, 0, 0], 0);
        continue;
      }
      const course = y % 46 < 4 || ((x + (Math.floor(y / 46) % 2) * 40) % 80) < 4;
      const t = 165 - (Math.abs(x - cx) / 260) * 40; // no per-pixel noise: keeps the PNG small
      set(x, y, course ? [110, 102, 92] : [t, t * 0.93, t * 0.82]);
    }
  writeFileSync(out("img/tower.png"), PNG.sync.write(png));
}

/** A castle keep on transparency: a broad block with a turret and a stair tower (spec §18's keep-cutout). */
function keep() {
  const { png, set, w, h } = canvas(900, 1200);
  const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x < x1 && y >= y0 && y < y1;
  const crenel = (x, y, x0, x1, top) => y >= top && y < top + 36 && Math.floor((x - x0) / 40) % 2 === 0 && x >= x0 && x < x1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const body = inRect(x, y, 170, 420, 730, h) || crenel(x, y, 170, 730, 384);
      const turret = inRect(x, y, 520, 160, 690, 420) || crenel(x, y, 520, 690, 124);
      const stair = inRect(x, y, 170, 280, 290, 420) || (y >= 200 && y < 280 && Math.abs(x - 230) < (y - 200) * 0.75);
      const slit = (inRect(x, y, 595, 230, 611, 300) || inRect(x, y, 440, 560, 456, 650) || inRect(x, y, 300, 700, 316, 790));
      if (!(body || turret || stair) || slit) {
        set(x, y, [0, 0, 0], 0);
        continue;
      }
      const course = y % 50 < 4 || ((x + (Math.floor(y / 50) % 2) * 45) % 90) < 4;
      const t = 172 - (y / h) * 30;
      set(x, y, course ? [112, 104, 94] : [t, t * 0.93, t * 0.8]);
    }
  writeFileSync(out("img/keep-cutout.png"), PNG.sync.write(png));
}

/** A portrait crop of a landscape, for the art-directed `src@phone`. */
function portrait(name, from) {
  const rel = (n) => (n.includes("/") ? n : `img/${n}`);
  execFileSync("sips", ["-c", "1000", "667", out(`${rel(from)}.jpg`), "--out", out(`${rel(name)}.jpg`)], { stdio: "ignore" });
}

/** "White Desert" cover: salt pans from above, pale rectangles in a grid of brine channels. */
function pans() {
  const { png, set, w, h } = canvas(1600, 1000);
  const r = rng(31);
  const cells = new Map();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const cx = Math.floor(x / 120);
      const cy = Math.floor(y / 80);
      if (!cells.has(`${cx},${cy}`)) cells.set(`${cx},${cy}`, 215 + r() * 35);
      const channel = x % 120 < 6 || y % 80 < 6;
      const t = cells.get(`${cx},${cy}`) + (r() - 0.5) * 10;
      set(x, y, channel ? [120, 150, 160] : [t, t * 0.98, t * 0.95]);
    }
  jpeg(png, "salt/pans-aerial");
}

/** "Forty Questions": a head-and-shoulders silhouette on transparency, facing left, for shape=alpha. */
function sitter() {
  const { png, set, w, h } = canvas(800, 1000);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const head = ((x - 380) / 150) ** 2 + ((y - 330) / 190) ** 2 < 1;
      const neck = Math.abs(x - 400) < 80 && y > 480 && y < 600;
      const shoulders = y >= 580 && Math.abs(x - 410) < 180 + (y - 580) * 0.9;
      if (!(head || neck || shoulders)) {
        set(x, y, [0, 0, 0], 0);
        continue;
      }
      const t = head ? 150 - (x - 230) / 8 : 70 + (y - 580) / 20;
      set(x, y, head ? [t + 40, t, t - 20] : [t * 0.5, t * 0.6, t * 0.9]);
    }
  writeFileSync(out("keeper/mairi-cutout.png"), PNG.sync.write(png));
}

landscape("dusk", { sky: [[26, 30, 58], [196, 108, 72], [236, 170, 110]], ground: [[58, 52, 60], [40, 36, 44], [24, 22, 28]], stars: false, wall: [214, 196, 170] });
landscape("night", { sky: [[6, 8, 18], [20, 26, 48], [36, 40, 62]], ground: [[16, 18, 24], [11, 12, 17], [6, 7, 10]], stars: true, wall: null });
// Spec §18 "Stone & Strategy": a video poster, a foggy valley and its portrait crop.
landscape("ramparts", { sky: [[40, 44, 70], [150, 110, 96], [196, 150, 120]], ground: [[70, 64, 66], [52, 48, 52], [34, 32, 36]], stars: false, wall: [226, 210, 186] });
landscape("valley", { sky: [[150, 158, 170], [200, 200, 196], [220, 216, 206]], ground: [[120, 126, 128], [98, 104, 106], [78, 84, 86]], stars: false, wall: null });
portrait("valley-portrait", "valley");
stones();
tower();
keep();
// Pictures for three test articles. Stand-ins: palettes, not photographs.
const SALT = { sky: [[200, 214, 226], [236, 232, 222], [246, 242, 232]], ground: [[222, 218, 208], [206, 200, 190], [186, 180, 170]], stars: false, wall: null };
const EARTH = { sky: [[120, 140, 160], [214, 196, 170], [230, 214, 190]], ground: [[150, 120, 90], [120, 94, 70], [90, 70, 52]], stars: false, wall: null };
pans();
portrait("salt/pans-aerial-portrait", "salt/pans-aerial");
landscape("salt/dusk", { sky: [[40, 36, 70], [210, 120, 90], [240, 190, 140]], ground: [[236, 226, 214], [214, 204, 194], [190, 182, 174]], stars: false, wall: null, seed: 5 });
["rake", "hands", "pump", "well", "children"].forEach((n, i) => landscape(`salt/${n}`, { ...(i % 2 ? EARTH : SALT), seed: 10 + i }));
[1, 2, 3, 4, 5].forEach((i) => landscape(`salt/s${i}`, { ...(i % 2 ? SALT : EARTH), seed: 20 + i, size: [800, 1000] }));
landscape("sig/box", { ...EARTH, seed: 40, wall: [120, 60, 40] });
landscape("sig/levers", { sky: [[120, 30, 30], [60, 60, 70], [30, 30, 36]], ground: [[20, 20, 24], [40, 40, 46], [16, 16, 20]], stars: false, wall: null, seed: 41 });
landscape("sig/night", { sky: [[6, 8, 18], [20, 26, 48], [36, 40, 62]], ground: [[16, 18, 24], [11, 12, 17], [6, 7, 10]], stars: true, wall: [240, 200, 120], seed: 42 });
landscape("keeper/mairi-1989", { sky: [[90, 110, 130], [150, 160, 170], [170, 176, 180]], ground: [[80, 90, 96], [60, 70, 76], [40, 48, 52]], stars: false, wall: [230, 230, 230], seed: 50, size: [1000, 1000] });
sitter();
console.log("wrote img/, salt/, sig/, keeper/");
