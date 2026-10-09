/**
 * Value types (grammar §04.1) and the schema row shape (grammar §06.1).
 *
 * The schema is DATA. Adding a command must never require touching parser
 * code -- it is a row here and a table row in the specification.
 */

// ---------------------------------------------------------------------------
// Values (grammar §08)
// ---------------------------------------------------------------------------

export type Unit = "px" | "rem" | "em" | "%" | "vw" | "vh" | "col" | "bl";

export const UNITS: readonly Unit[] = ["px", "rem", "em", "%", "vw", "vh", "col", "bl"];

/** Palette roles are a closed set (spec §07.3). */
export const ROLES = ["paper", "ink", "muted", "accent", "rule"] as const;
export type Role = (typeof ROLES)[number];

/**
 * `raw` carries the author's original spelling. The AST is the formatter's
 * input (grammar §09 rule 7 requires colors to round-trip as written), so
 * every value keeps it even when the typed form is canonical.
 */
type WithRaw = { raw: string };

export type Value =
  | ({ t: "integer" | "number"; n: number } & WithRaw)
  | ({ t: "length"; n: number; unit: Unit } & WithRaw)
  | ({ t: "percentage"; n: number } & WithRaw)
  | ({ t: "time"; ms: number } & WithRaw)
  | ({ t: "range"; from: number; to: number | "end" } & WithRaw)
  | ({ t: "ratio"; w: number; h: number; auto?: false } & WithRaw)
  | ({ t: "ratio"; auto: true } & WithRaw)
  | ({ t: "color"; hex: string } & WithRaw)
  | ({ t: "role" | "enum" | "ident"; id: string } & WithRaw)
  | ({ t: "boolean"; b: boolean } & WithRaw)
  | ({ t: "string" | "path"; s: string } & WithRaw)
  | ({ t: "pair"; a: Value; b: Value } & WithRaw)
  | ({ t: "fluid"; min: Value; max: Value; from?: Value; to?: Value } & WithRaw)
  | ({ t: "poly"; points: [number, number][] } & WithRaw)
  | ({ t: "tokenref"; name: string } & WithRaw)
  | ({ t: "any"; raw: string });

// ---------------------------------------------------------------------------
// Declared types
// ---------------------------------------------------------------------------

export type TypeName =
  | "integer"
  | "number"
  | "length"
  | "percentage"
  | "time"
  | "range"
  | "ratio"
  | "color"
  | "role"
  | "boolean"
  | "enum"
  | "ident"
  | "string"
  | "path"
  | "pair"
  | "fluid"
  | "poly"
  | "any";

/**
 * Types a token reference may stand in for (grammar §04.1 rule 2). It is
 * rejected for `ident`, `enum`, `boolean`, `range`, `path` and `role`.
 */
export const TOKENREF_OK: ReadonlySet<TypeName> = new Set<TypeName>([
  "integer",
  "number",
  "length",
  "percentage",
  "time",
  "color",
  "ratio",
  "string",
]);

export type AttrSchema = {
  /** Declared types, tried in the order given in grammar §04.1 rule 1. */
  types: readonly TypeName[];
  /** Allowed identifiers when `types` includes "enum". */
  enum?: readonly string[];
  /** Element type when `types` includes "pair". */
  pairOf?: TypeName;
  required?: boolean;
  /** Canonical source spelling of the default, for the formatter and docs. */
  default?: string;
  /** false rejects an `@breakpoint` suffix (grammar §06.1). Defaults to true. */
  responsive?: boolean;
  /** Prose note carried into the printed table. */
  note?: string;
};

export type BodyArity = "none" | "optional" | "required";
export type BodyKind = "struct" | "inline" | "block" | "scene";

/** A cross-field check. Returns a code + message or null. */
export type CrossFieldRule = {
  /** Diagnostic code emitted when the rule fires. */
  code: "P015" | "P016" | "P044";
  /** Human-readable description, used by the table printer. */
  describe: string;
  /**
   * Given the command's attribute keys (base keys, suffix stripped) and
   * whether it has a body, return the failing attribute key or null.
   */
  check: (ctx: { keys: ReadonlySet<string>; enumValue: (k: string) => string | undefined; hasBody: boolean }) =>
    | { key: string; message: string }
    | null;
};

export type CommandSchema = {
  name: string;
  /** Inline-class commands join a paragraph; block-class commands end one. */
  class: "inline" | "block";
  arity: BodyArity;
  kind: BodyKind | null;
  /** Allowed child command names. "#paragraph" allows paragraphs. */
  children: readonly string[];
  /** Children limited to one occurrence. */
  maxOnce: readonly string[];
  attrs: Readonly<Record<string, AttrSchema>>;
  rules: readonly CrossFieldRule[];
  /** Specification sections this row was transcribed from. */
  spec: string;
};

export const PARAGRAPH = "#paragraph";
