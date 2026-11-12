# 0006. The package ships its source, owns the regex engine's pin, and keeps propslab's test layout

- **Status:** Accepted
- **Date:** 2026-11-12
- **Issue:** #2

## Context

[propslab ADR 0023](https://github.com/Bimmiest/propslab/blob/main/docs/adr/0023-the-engine-moves-to-a-repository-of-its-own.md)
moved the engine here, as a library that consumers install by tag. That
record chose the place. It did not choose the shape of the package, or how
this repository differs from repo-template.

The consumers on 2026-11-12:

- propslab's app bundles the engine with Vite, in a page and in Web Workers.
- propslab's MCP server bundles it with esbuild, and type-checks it with a
  `tsc` that does not set `allowImportingTsExtensions`.
- propslab-sb bundles it into a Splunk app. propslab-ent runs it under `tsx`
  and bundles it with esbuild.

Each one compiles TypeScript already, and each one installs
`pcre2-wasm-utf16` from git, which ships its source too
(pcre2-wasm-utf16 ADR 0003).

The engine came with more than 100 test files in `__tests__/` folders. The
template puts each test next to its code (template ADR 0004).

## Decision

1. **The package ships its TypeScript source.** `exports` names
   `src/index.ts`, and there is no build output. Each consumer compiles the
   engine with its own toolchain. `npm run build` type-checks `src/` against
   ES2022 alone, with no DOM and no Node types, as a consumer gets it.
2. **`moduleResolution` is `bundler`**, and the imports have no extension.
   The template's `NodeNext` needs `.ts` on each import, and the MCP
   server's `tsc` refuses that in a dependency.
3. **`"sideEffects": false`.** No module of the engine does anything when it
   loads. With the hint, a bundler drops each module that a consumer does
   not use, and the one entry point does not put the whole engine in a
   page's startup bundle. Without it, propslab's startup bundle grew by
   about 34 kB.
4. **This repository owns the `pcre2-wasm-utf16` pin and its checksum.**
   CI compares the installed `pcre2.wasm` with `pcre2.wasm.sha256`, and
   `exports` names that file, so that a consumer checks the binary that it
   ships against the same hash. A consumer pins the same commit.
5. **The tests stay in `__tests__/` folders.** A test reaches the shared
   builders by a relative path that depends on the layout, and the move
   changes no behaviour. This is a deviation from template ADR 0004, and
   `docs/testing.md` records it.

## Consequences

- No build step, and no `dist/` to publish or keep current. A consumer
  needs TypeScript, and a consumer that runs plain JavaScript under Node
  cannot use the package without a bundler or `tsx`.
- A new module must have no effect when it loads. A module that registers
  itself is dropped by a consumer's bundler, and no check here finds that.
  `CONTRIBUTING.md` states the rule.
- A pin bump of `pcre2-wasm-utf16` is a release of this package, and then a
  pin bump in each consumer.
- The tests can move next to their code in a change of their own. That
  change supersedes item 5 of this record.
