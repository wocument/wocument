/**
 * Row packing for `\group[layout=row]` (spec §11.11, design 2026-09-26):
 * Figma's wrap sizing (fixed, fill, min, max) in whole grid columns. Pure, so
 * the rules are tested without a text engine.
 */

/** A child's size in columns. A fixed child has `min === max`. */
export type RowItem = { min: number; max: number; fixed: boolean };

/** A child's place in its row: which item, and how many columns it spans. */
export type RowSlot = { index: number; span: number };

/**
 * Packs `items` into rows of `n` columns, in order:
 *
 * 1. Each child needs its minimum (clamped to 1..n). It joins the current row
 *    if the row's minimums still fit, and otherwise starts a new row.
 * 2. Every row but a short last one shares its spare columns evenly between its
 *    fill children, extras to the earliest, each stopping at its maximum.
 * 3. A last row, when there is more than one, keeps the columns of the row
 *    above: each fill child grows by that row's per-child growth,
 *    `floor(spare / fill children)`, and the rest stays empty.
 */
export function packRows(items: readonly RowItem[], n: number): RowSlot[][] {
  type Slot = RowSlot & { item: RowItem };
  const rows: Slot[][] = [];
  let row: Slot[] = [];
  let used = 0;
  items.forEach((item, index) => {
    const min = Math.max(1, Math.min(n, item.min));
    if (row.length > 0 && used + min > n) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push({ index, span: min, item });
    used += min;
  });
  if (row.length > 0) rows.push(row);

  const cap = (s: Slot): number => Math.max(s.span, Math.min(n, s.item.max));
  let growth = 0;
  rows.forEach((r, i) => {
    const fill = r.filter((s) => !s.item.fixed);
    let spare = n - r.reduce((sum, s) => sum + s.span, 0);
    if (i > 0 && i === rows.length - 1) {
      for (const s of fill) {
        const g = Math.min(growth, cap(s) - s.span, spare);
        s.span += g;
        spare -= g;
      }
      return;
    }
    growth = fill.length > 0 ? Math.floor(spare / fill.length) : 0;
    // Even shares; a child at its maximum drops out and the rest share again.
    while (spare > 0) {
      const open = fill.filter((s) => s.span < cap(s));
      if (open.length === 0) break;
      const base = Math.floor(spare / open.length);
      let extra = spare % open.length;
      let gave = 0;
      for (const s of open) {
        const want = base + (extra > 0 ? 1 : 0);
        if (extra > 0) extra--;
        const g = Math.min(want, cap(s) - s.span);
        s.span += g;
        gave += g;
      }
      spare -= gave;
      if (gave === 0) break;
    }
  });
  return rows.map((r) => r.map(({ index, span }) => ({ index, span })));
}
