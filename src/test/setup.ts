// Runs before every test file. The regex engine is PCRE2 in WebAssembly, and a
// consumer instantiates it once before any pattern compiles; this does the same
// for the suite. The path comes from vitest.config.ts.
//
// The module itself, not the package's entry point: importing the entry point
// here would load every engine module before a test's vi.mock registers, and
// the mock would then miss the module it names.
import { readFileSync } from 'node:fs';
import { initRegexEngineSync } from '../utils/splunkRegex';

declare const __PCRE2_WASM_PATH__: string;
initRegexEngineSync(readFileSync(__PCRE2_WASM_PATH__));
