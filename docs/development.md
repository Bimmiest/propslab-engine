---
type: how-to
---

# Development

How to set up a checkout, run the gates, record tech debt, and find the cause
of a failure. The rules are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Set up

1. Install the Node version in `.nvmrc`: `nvm install`.
2. Install the dependencies: `npm ci`.

`devEngines` in `package.json` refuses a Node version outside its range,
before npm resolves the dependencies. The error is `EBADDEVENGINES`, with the
required and the current version. npm also checks `devEngines` before
`npm run`, so a gate on a wrong Node stops with the same error. If you get
this error, run `nvm use` and try again.

`engine-strict=true` in `.npmrc` refuses a dependency whose `engines` range
does not include your Node, with `EBADENGINE`. It also refuses a wrong Node
on an npm older than 10.9.0, which ignores `devEngines`. That npm checks
`engines` only after it resolves the dependencies, so a resolution error can
come first.

## Run the gates

Run the five gates before you open a pull request. CI runs the same commands.

```bash
npm run lint && npm run format:check && npm run typecheck && npm run test:coverage && npm run build
```

To run one test file, use `npx vitest run src/path/to/file.test.ts`. To run
the tests that have a name, use `npx vitest run -t "part of the name"`.

To run a shared check locally, clone `shared-workflows` next to this
repository, and run its script from here:

```bash
node ../shared-workflows/.github/actions/docs-check/docs-check.mjs
```

## Tech debt

Tech debt is work that operates now but must change later. An issue with the
label `tech-debt` records it, so that people can plan it. A bug is different:
the code does not do what it must. An enhancement is different: it adds
behaviour.

Open the issue, with the form **Tech debt**, in the pull request that makes
the compromise. These are the usual causes:

- **You hold a version back.** An `ignore` entry in `.github/dependabot.yml`
  that holds a version until something changes names the issue. An entry
  that records a permanent rule, for example two packages that always move
  together, gives its reason and needs no issue.
- **A version move needs more than a bump.** A Dependabot pull request that
  cannot pass alone, for example a major that needs a migration, gets an
  issue that says what the move needs. Link the pull request from the issue.
- **A workaround waits for a fix in a different project**, for example a bug
  in a dependency, or a feature that the forge does not have. The comment at
  the workaround names the issue: `TODO(#123): what is not done.`

Before you open an issue, search the open `tech-debt` issues. One cause has
one issue, so two holds that the same migration removes share an issue.

Pay the debt in a change that touches its code, or plan it as other work.
The pull request that removes the hold or the workaround closes the issue. It
also removes the `ignore` entry or the comment.

## Traps

Add a trap below [In this repository](#in-this-repository) when it costs a
contributor time and a check cannot find it. Give the symptom first, then the
cause, then the fix. If a trap belongs to an area, put it below the same
heading in the topic file of that area: [ci.md](ci.md),
[testing.md](testing.md), [code-style.md](code-style.md),
[dependencies.md](dependencies.md) or [documentation.md](documentation.md).

## In this repository

### Scripts

| Command | What it does |
|---|---|
| `npm test` | Runs all the tests. A full run also records the evidence for the evidence gate ([testing.md](testing.md#the-evidence-gate)). |
| `npm run test:coverage` | Runs the tests with the coverage floors. |
| `npm run build` | Type-checks `src/` as a consumer gets it: no tests, no Node types, ES2022 only. It emits nothing. |
| `npm run test:mutation` | Runs Stryker. Add `-- --mutate <file>` for one file. |
| `npm run test:mutation:canary` | Proves that Stryker still runs the tests of each mutant. |
| `node scripts/check-wasm-checksum.mjs` | Compares the installed `pcre2.wasm` with `pcre2.wasm.sha256`. |
| `node scripts/generate-cim-models.js <Splunk_SA_CIM>` | Makes `src/cim/cimModelsData.ts` again from the CIM add-on ([recipes.md](recipes.md#add-or-update-a-cim-model)). |
| `node scripts/check-ignored-issues.mjs` | The weekly roster check. Set `GITHUB_TOKEN` to avoid the API's limit. |

### A change that a consumer must see before a release

In the consumer, install your checkout in place of the tag:
`npm install ../propslab-engine`. Do not commit that change. When the engine
change merges, release it, and bump the pin in the consumer.

### Traps

- **A script throws when it compiles a pattern.** The regex engine is
  WebAssembly, and nothing can compile a pattern before it loads. The tests
  load it in `src/test/setup.ts`. A script calls `initRegexEngineSync`
  first, as [api.md](api.md#initialising-it) shows.
- **A `vi.mock` of an engine module has no effect.** Something loaded the
  module before the mock was registered. `src/test/setup.ts` imports
  `splunkRegex.ts` itself, and not `src/index.ts`, for this reason: the
  entry point loads every module.
- **`directiveEvidence.test.ts` skips.** It needs a full run: `npm test`
  with no file filter, project or name pattern. CI always records.
