import type { CommandSchema } from "../types.js";
import { DEFINITIONS } from "./definitions.js";
import { OBJECT_COMMANDS } from "./objects.js";
import { PARENT, STRUCTURE_COMMANDS } from "./structure.js";
import { TEXT_COMMANDS } from "./text.js";
import { INLINE_CLASS } from "./sets.js";

const ALL: readonly CommandSchema[] = [
  ...DEFINITIONS,
  ...STRUCTURE_COMMANDS,
  ...TEXT_COMMANDS,
  ...OBJECT_COMMANDS,
];

export const COMMANDS: ReadonlyMap<string, CommandSchema> = new Map(ALL.map((c) => [c.name, c]));

export const COMMAND_NAMES: readonly string[] = ALL.map((c) => c.name).sort();

/** Definition commands, which must precede all other content (grammar §07). */
export const DEFINITION_COMMANDS: ReadonlySet<string> = new Set([
  ...DEFINITIONS.map((d) => d.name),
  PARENT.name,
]);

export const INLINE_CLASS_NAMES: ReadonlySet<string> = new Set(INLINE_CLASS);

export function lookup(name: string): CommandSchema | undefined {
  return COMMANDS.get(name);
}
