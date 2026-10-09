/**
 * Frontmatter field table (spec §04). Metadata only -- no layout or design
 * values live here. Unknown fields are a parse error (P002).
 */

export type FrontmatterFieldType = "integer" | "string" | "string-or-list" | "path" | "date";

export type FrontmatterField = {
  name: string;
  type: FrontmatterFieldType;
  required: boolean;
  note?: string;
};

export const FRONTMATTER_FIELDS: readonly FrontmatterField[] = [
  { name: "wmxdsl", type: "integer", required: true, note: "Language major version. Currently 1." },
  { name: "title", type: "string", required: true, note: "Used for <title> and social cards." },
  { name: "lang", type: "string", required: false, note: "BCP-47 tag. Default en." },
  { name: "theme", type: "path", required: false, note: "One theme file. The only import mechanism." },
  { name: "description", type: "string", required: false },
  { name: "author", type: "string-or-list", required: false, note: "Metadata only; the visible byline is \\byline." },
  { name: "date", type: "date", required: false, note: "ISO date." },
  { name: "section", type: "string", required: false },
  { name: "social-image", type: "path", required: false },
];

export const FRONTMATTER_BY_NAME: ReadonlyMap<string, FrontmatterField> = new Map(
  FRONTMATTER_FIELDS.map((f) => [f.name, f]),
);

/** The typed result of a successful frontmatter parse. */
export type Frontmatter = {
  wmxdsl: number;
  title: string;
  lang?: string;
  theme?: string;
  description?: string;
  author?: string | string[];
  date?: string;
  section?: string;
  "social-image"?: string;
};
