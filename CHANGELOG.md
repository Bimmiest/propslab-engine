# Changelog

This file records the notable changes to propslab-engine, newest first. Each entry says what changed for a user, in one or two sentences, with the issue link. The reasons for larger design choices are in [`docs/adr/`](docs/adr/README.md).

A release changes `Unreleased` to `x.y.z — YYYY-MM-DD`, and adds a new `Unreleased` above it ([CONTRIBUTING](CONTRIBUTING.md#releases)).

---

## Unreleased

## 0.4.0 — 2026-11-13

### Added

- The `exports` map names `./package.json`. Thus a consumer can resolve
  `propslab-engine/package.json`, for example to read the version of the
  engine ([#25](https://github.com/Bimmiest/propslab-engine/issues/25)).

### Removed

- **Breaking:** the engine does not export the types `OutputTabId` and
  `PreviewSubTabId`. They are the tab ids of the propslab UI, and the engine
  does not use them. A consumer that uses them must declare them in its own
  code ([#7](https://github.com/Bimmiest/propslab-engine/issues/7)).

## 0.3.0 — 2026-11-13

### Added

- `DIAGNOSTIC_CODES`, every `DiagnosticCode` as a list, so that a consumer
  can name them at run time, for example in a schema. `DiagnosticCode` is
  now derived from it ([#22](https://github.com/Bimmiest/propslab-engine/issues/22)).

### Fixed

- Seven patterns took quadratic time, or worse, on crafted input: a conf line
  or an `EXTRACT` value with a long run of whitespace, and a sample with many
  blank lines or unterminated XML constructs. Each one is now linear, with
  the same result. The XML tag scan of the Scaffold also stops an attribute
  value at `<`, which XML does not allow there
  ([#20](https://github.com/Bimmiest/propslab-engine/issues/20)).

## 0.2.0 — 2026-11-13

### Changed

- **Breaking:** each `ValidationDiagnostic` has a required `code`, of the
  new exported type `DiagnosticCode`. A caller can act on the kind of a
  diagnostic without a match on its message. A consumer that builds a
  `ValidationDiagnostic` must give it a code.
  [docs/api.md](docs/api.md#diagnostics) lists the codes
  ([#4](https://github.com/Bimmiest/propslab-engine/issues/4)).

## 0.1.0 — 2026-11-12

### Added

- The engine, with its tests and its history, from
  [propslab](https://github.com/Bimmiest/propslab). Its public API is
  `src/index.ts`, and a consumer installs a tag
  ([propslab ADR 0023](https://github.com/Bimmiest/propslab/blob/main/docs/adr/0023-the-engine-moves-to-a-repository-of-its-own.md)).
- The package ships `scripts/generate-cim-models.js`, so that a consumer can
  read its `INCLUDE` table, the datasets that `CIM_MODELS` presents.
