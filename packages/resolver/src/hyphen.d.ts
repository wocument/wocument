/** Minimal types for the `hyphen` package, which ships none. Only what text.ts uses. */
declare module "hyphen/en-us/index.js" {
  const hyphen: { hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number }): string };
  export default hyphen;
}
