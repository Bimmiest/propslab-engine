# Changelog

This file records the notable changes to propslab-engine, newest first. Each entry says what changed for a user, in one or two sentences, with the issue link. The reasons for larger design choices are in [`docs/adr/`](docs/adr/README.md).

A release changes `Unreleased` to `x.y.z — YYYY-MM-DD`, and adds a new `Unreleased` above it ([CONTRIBUTING](CONTRIBUTING.md#releases)).

---

## Unreleased

### Added

- `DIAGNOSTIC_CODES`, every `DiagnosticCode` as a list, so that a consumer
  can name them at run time, for example in a schema. `DiagnosticCode` is
  now derived from it ([#22](https://github.com/Bimmiest/propslab-engine/issues/22)).

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
