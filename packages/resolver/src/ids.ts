/**
 * Element ids: the author's `name`, else `<command>-<n>`
 * numbered per command in document order, skipping numbers an author name
 * already uses. Scenes are `scene-<n>` (spec §08.1). Namespaces are per kind
 *: scenes, frames, objects.
 */

import type { Command, Node } from "@wmxdsl/parser";

const OBJECTS = new Set(["figure", "video", "embed", "lottie", "audio", "gallery", "pullquote", "sidebar", "group", "rule"]);

const kindOf = (name: string): "scene" | "frame" | "object" | null =>
  name === "scene" ? "scene" : name === "frame" ? "frame" : OBJECTS.has(name) ? "object" : null;

const authorName = (c: Command): string | null => {
  const v = c.attrs.find((a) => a.key === "name" && a.at === null)?.value;
  return v?.t === "ident" ? v.id : null;
};

export class Ids {
  private readonly ids = new Map<number, string>();

  /**
   * `roots` in document order: definitions (parent bodies), stories, then scenes.
   * `implicit` is the implicit form's content (spec §02.2), which is story content.
   */
  constructor(roots: readonly Node[], implicit: readonly Node[] = []) {
    const all: Command[] = [];
    const walk = (nodes: readonly Node[], inStory: boolean): void => {
      for (const n of nodes) {
        if (n.kind !== "command") continue;
        // A \rule inside story content is a block, not an object: it gets no id.
        if (kindOf(n.name) && !(n.name === "rule" && inStory)) all.push(n);
        if (Array.isArray(n.body)) walk(n.body as Node[], n.name === "story" || n.name === "frame" || inStory);
      }
    };
    walk(roots, false);
    walk(implicit, true);

    const taken = new Map<string, Set<string>>();
    for (const c of all) {
      const name = authorName(c);
      if (name === null) continue;
      const kind = kindOf(c.name)!;
      const set = taken.get(kind) ?? new Set<string>();
      if (set.has(name)) throw new Error(`duplicate ${kind} name "${name}" (line ${c.source.line})`);
      set.add(name);
      taken.set(kind, set);
    }
    const counters = new Map<string, number>();
    for (const c of all) {
      let id = authorName(c);
      if (id === null) {
        const kind = kindOf(c.name)!;
        const used = taken.get(kind) ?? new Set<string>();
        let n = counters.get(c.name) ?? 0;
        do id = `${c.name}-${++n}`;
        while (used.has(id));
        counters.set(c.name, n);
        used.add(id);
        taken.set(kind, used);
      }
      this.ids.set(c.id, id);
    }
  }

  of(c: Command): string {
    const id = this.ids.get(c.id);
    if (id === undefined) throw new Error(`no id for \\${c.name} at line ${c.source.line}`);
    return id;
  }
}
