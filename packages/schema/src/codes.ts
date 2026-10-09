/**
 * Every diagnostic code from wmxdsl-grammar.md §11.
 *
 * Codes are stable; messages may be reworded. Message templates take a small
 * bag of named parameters so call sites stay readable and the wording lives
 * in exactly one place.
 */

export type Severity = "error" | "warning";

export type CodeSpec = {
  readonly code: string;
  readonly severity: Severity;
  /** Renders the message body. Params are code-site supplied. */
  readonly message: (p: Readonly<Record<string, string>>) => string;
};

const e = (
  code: string,
  message: (p: Readonly<Record<string, string>>) => string,
): CodeSpec => ({ code, severity: "error", message });

/** Grammar §11. Every entry is an error; the `W` codes belong to resolve/layout. */
export const CODES = {
  // --- Lexical ---------------------------------------------------------
  L001: e("L001", () => "Invalid UTF-8 in source file."),
  L002: e("L002", () => "Unterminated string: the file ended inside a quoted value."),
  L003: e("L003", (p) => `Malformed attribute list: ${p.what ?? "unexpected character"}.`),
  L004: e(
    "L004",
    (p) => `Invalid escape \\${p.char ?? ""}: a backslash must introduce a command or an escapable character.`,
  ),
  L005: e("L005", () => "Unterminated frontmatter: no closing `---` fence before end of file."),
  L006: e("L006", () => "Newline inside a string value. Strings cannot span lines."),

  // --- Frontmatter -----------------------------------------------------
  P001: e("P001", (p) => `Frontmatter missing or not valid YAML${p.detail ? `: ${p.detail}` : "."}`),
  P002: e("P002", (p) => `Unknown frontmatter field \`${p.field ?? ""}\`.`),
  P003: e(
    "P003",
    (p) =>
      p.reason === "type"
        ? `Frontmatter field \`${p.field ?? ""}\` has the wrong type (expected ${p.expected ?? "?"}).`
        : `Required frontmatter field \`${p.field ?? ""}\` is missing.`,
  ),

  // --- Surface / braces ------------------------------------------------
  P010: e("P010", (p) =>
    p.why === "unclosed"
      ? `Body opened here is never closed.`
      : `\`{\` does not open a command body here.`,
  ),
  P011: e("P011", () => "`}` closes nothing."),

  // --- Names and attributes -------------------------------------------
  P012: e("P012", (p) => `Unknown command \\${p.name ?? ""}.`),
  P013: e("P013", (p) =>
    p.why === "nonresponsive"
      ? `Attribute \`${p.key ?? ""}\` cannot vary by breakpoint.`
      : `Unknown attribute \`${p.key ?? ""}\` on \\${p.command ?? ""}.`,
  ),
  P014: e("P014", (p) => `Duplicate attribute \`${p.key ?? ""}\`.`),
  P015: e("P015", (p) => `\`${p.key ?? ""}\` expects ${p.expected ?? "a different type"}.`),
  P016: e("P016", (p) => `\\${p.command ?? ""} requires the attribute \`${p.key ?? ""}\`.`),

  // --- Bodies ----------------------------------------------------------
  P017: e("P017", (p) => `\\${p.command ?? ""} takes no body.`),
  P018: e("P018", (p) => `\\${p.command ?? ""} requires a body.`),
  P019: e("P019", (p) => `\\${p.command ?? ""} has an empty body.`),
  P020: e("P020", (p) =>
    p.why === "once"
      ? `\\${p.name ?? ""} may appear only once inside \\${p.parent ?? ""}.`
      : `\\${p.name ?? ""} is not allowed inside \\${p.parent ?? "the document"}.`,
  ),
  P021: e("P021", (p) => `Text is not allowed inside \\${p.command ?? ""}; only commands are.`),
  P022: e("P022", (p) => `Paragraph break inside \\${p.command ?? ""}, which takes inline text only.`),
  P023: e("P023", (p) => `\\${p.name ?? ""} is a block command and cannot appear inside \\${p.parent ?? ""}.`),

  // --- Inline ----------------------------------------------------------
  P030: e("P030", (p) => `${p.what ?? "Emphasis"} is never closed.`),
  P031: e("P031", (p) => `${p.what ?? "Emphasis"} closed in the wrong order.`),
  P032: e("P032", () => "Code span is never closed."),
  P033: e("P033", (p) => `\\${p.name ?? ""} appears inside a code span.`),
  P034: e("P034", () => "Run of four or more asterisks."),
  P035: e("P035", () => "A link cannot contain another link."),
  P036: e("P036", () => "Empty code span."),

  // --- Document --------------------------------------------------------
  P040: e("P040", (p) => `\\${p.name ?? ""} is a definition and must come before the first story, scene or content.`),
  P041: e("P041", () => "Top-level content in a document that has scenes."),
  P042: e("P042", () => "Text content in a scene that has frames or groups."),
  P043: e("P043", () => "More than one document-level \\folio."),
  P044: e("P044", () => "\\frame has both `story=` and a body."),
  P045: e("P045", (p) => `Theme files contain definitions only; found ${p.what ?? "other content"}.`),
} as const satisfies Record<string, CodeSpec>;

export type DiagnosticCode = keyof typeof CODES;

export const ALL_CODES = Object.keys(CODES) as DiagnosticCode[];
