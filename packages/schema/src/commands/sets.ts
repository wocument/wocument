/** Child sets from grammar §06. */

export const TEXT_EL = [
  "kicker", "headline", "deck", "byline", "meta", "lede", "subhead", "bio", "blockquote", "credit",
] as const;

export const MARKER = ["dropcap", "framebreak", "rule", "music"] as const;

export const OBJECT = [
  "figure", "video", "embed", "lottie", "audio", "gallery", "pullquote", "sidebar",
] as const;

export const PARAGRAPH_CHILD = "#paragraph";

/** STORY-CONTENT = paragraphs + TEXT-EL + MARKER + OBJECT. */
export const STORY_CONTENT: readonly string[] = [PARAGRAPH_CHILD, ...TEXT_EL, ...MARKER, ...OBJECT];

/** Inline-class commands: exactly these three (grammar §05.2). */
export const INLINE_CLASS = ["br", "span", "endmark"] as const;
