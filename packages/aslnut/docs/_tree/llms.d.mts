// the types of llms.mjs (test/llms.test.ts reads it)
/** where llms.txt is written (docs/llms.txt) */
export const OUT: string;
/** llms.txt as its sources make it now */
export function build(): Promise<string>;
