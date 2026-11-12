<p align="center">
  <img src="docs/assets/banner.svg" alt="propslab-engine" width="100%">
</p>

<p align="center">
  <a href="https://github.com/Bimmiest/propslab-engine/actions/workflows/ci.yml"><img src="https://github.com/Bimmiest/propslab-engine/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/Bimmiest/propslab-engine/actions/workflows/security.yml"><img src="https://github.com/Bimmiest/propslab-engine/actions/workflows/security.yml/badge.svg" alt="Security status"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/Bimmiest/propslab-engine"><img src="https://api.scorecard.dev/projects/github.com/Bimmiest/propslab-engine/badge" alt="OpenSSF Scorecard"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-MIT-blue" alt="Licence: MIT"></a>
</p>

# propslab-engine

A TypeScript library that simulates how Splunk processes raw data with
`props.conf` and `transforms.conf`, for tools that must show the result
without a Splunk indexer.

## Highlights

- **The index-time pipeline in Splunk's order:** line breaking, line merging,
  timestamps, `SEDCMD`, `TRANSFORMS`, `INGEST_EVAL` and the routing keys.
- **The search-time extractions:** `EXTRACT`, `REPORT`, `KV_MODE`, `FIELDALIAS`
  and `EVAL`.
- **Stanza precedence as Splunk resolves it,** and layered input
  (`default`, then `local`) with the provenance of each attribute.
- **Splunk's regex semantics:** each pattern that a user writes runs on PCRE2,
  compiled to WebAssembly.
- **No UI, no network and no Node APIs:** the same code runs in a browser, a
  Web Worker and Node.

## Overview

You give the engine a raw log, its metadata, a `props.conf` and a
`transforms.conf`. It divides the log into events and runs the stages of the
pipeline in the order that Splunk uses. The result has the events, their
fields and timestamps, the diagnostics, and a trace of each stage.

[Propslab](https://github.com/Bimmiest/propslab) is the first consumer: a
browser simulator, and an MCP server. The engine moved here from that
repository with its history
([propslab ADR 0023](https://github.com/Bimmiest/propslab/blob/main/docs/adr/0023-the-engine-moves-to-a-repository-of-its-own.md)).

**Maturity.** The engine is pre-release ([CHANGELOG](CHANGELOG.md)). A release
is a `v*` tag, and a consumer installs a tag. Before 1.0, a breaking change of
the API increments the minor version. Each directive that the registry knows
has one of three support levels. [`src/directiveSupport.ts`](src/directiveSupport.ts)
declares them:

| Level | Count | What it means |
|---|---|---|
| **simulated** | 77 | The engine implements it, and tests assert the behaviour. |
| **documented** | 72 | Recognised on purpose, and outside the simulation for a reason that does not change. It belongs to a layer that a browser cannot access, or it has no observable effect on the output. |
| **ignored** | 0 | Must be simulated, but is not yet. Its entry names the issue that tracks it. Each one of these is a known wrong answer. |

A test asserts the counts against the table itself, so they cannot become
incorrect. **0** attributes are valid in Splunk 10.4.3 and absent from the
registry.

**What it is not.** The engine is not Splunk, and it does not prove that a
config is correct. It does not simulate lookups, the forwarder and input
layers, or segmentation. This repository does not distribute recorded output
from Splunk Enterprise, so the tests assert against the documentation
([propslab ADR 0016](https://github.com/Bimmiest/propslab/blob/main/docs/adr/0016-recorded-splunk-output-is-not-distributed.md)).
If an output looks incorrect, compare it with a real indexer before you rely
on it. [docs/fidelity.md](docs/fidelity.md) gives the full boundary.

## Demo

```ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initRegexEngineSync, runPipeline } from 'propslab-engine';

initRegexEngineSync(readFileSync(createRequire(import.meta.url).resolve('pcre2-wasm-utf16/pcre2.wasm')));

const { result, diagnostics } = runPipeline(
  '2026-01-15T10:00:00Z user=alice action=login\n',
  { index: 'main', host: 'web01', source: '/var/log/app.log', sourcetype: 'app' },
  '[app]\nEXTRACT-user = user=(?<user>\\w+)\n',
  '',
  { now: Date.now() },
);
result.events[0]?.fields['user']; // 'alice'
diagnostics; // []
```

## Usage

```ts
import { runPipeline } from 'propslab-engine';
```

[docs/api.md](docs/api.md) gives the signature of `runPipeline`, the layered
input, how to load the regex engine in a browser, a worker and Node, and the
limits of a run. [docs/pipeline.md](docs/pipeline.md) gives the order of the
stages and stanza precedence.

## Installation

```bash
npm install github:Bimmiest/propslab-engine#v0.1.0
```

The package ships its TypeScript source. Your bundler or `tsc` compiles it,
with `moduleResolution` set to `bundler`.

To work on the engine:

```bash
nvm use    # the Node version in .nvmrc
npm ci
npm run lint && npm run format:check && npm run typecheck && npm run test:coverage && npm run build
```

Requirements: Node, at the version in [`.nvmrc`](.nvmrc).

## Documentation

The topic files are listed in [docs/README.md](docs/README.md). The documents
outside `docs/`:

- [CONTRIBUTING.md](CONTRIBUTING.md) — The rules: issues, branches, commits, pull requests, decisions, security and releases
- [CHANGELOG.md](CHANGELOG.md) — What changed for a user, newest first
- [SECURITY.md](SECURITY.md) — How to report a vulnerability, and what is in scope
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — The Contributor Covenant, enforced through the security contact

## Contributing and feedback

To report a bug or to suggest a change, open an issue. If the engine gives a
result that real Splunk does not, open a fidelity question, with the input,
the stanza and what Splunk produced. Before you open a pull request, read
[CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE). The [NOTICE](NOTICE) file gives the attribution for the
third-party material that this project derives data from.
