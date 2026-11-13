---
type: reference
---

# Dependencies

The rules for dependencies, and how to review an update. CONTRIBUTING.md has the summary.

## The rules

- **Use a caret range. The lockfile is the pin.** Write the reason next to
  each exception (for example, the `~` on `typescript`).
- **Declare a package where you import it.** In a repository with
  workspaces, declare each package in the workspace that uses it, not also at
  the root. Use one range for each name across all manifests.
- **Dependabot** proposes updates each week, with a seven-day cooldown. It
  groups minor and patch updates, and proposes each major on its own. Each
  `ignore` entry in `.github/dependabot.yml` has its reason. An entry that
  holds a version until something changes also names its `tech-debt` issue
  ([Tech debt](development.md#tech-debt)).
- **Read the lockfile diff of each Dependabot pull request.** A nested copy,
  such as `+ "packages/web/node_modules/<package>"`, tells you that the top
  level cannot take that version. `npm ci` then installs the package with a
  peer dependency that is not satisfied, and `verify` can stay green. To
  correct this, run `npm dedupe`, or update the related packages in one change.
- **Do not fix a group on the Dependabot branch.** If one package of a group
  merges separately, Dependabot closes the group, deletes its branch and opens
  a new group. Put the fix on a `chore/` branch from `origin/main`, and close
  the group as superseded.
- **Read each advisory. Do not apply fixes automatically.** One time,
  `npm audit fix --force` proposed to move a dependency thirteen minor
  versions back. If a high advisory has no path that the code can reach,
  list it in `.audit-exceptions.json` with the reason and an expiry date. An
  entry that has expired, or that no advisory needs, fails CI.
- **Licences.** The licence of each production dependency is on
  `.licence-allowlist.json`. Otherwise the file names the package, the
  version that a person read, and why it is acceptable.
- **Pin a git dependency to a commit**, not a tag, because a tag can move.
  The dependency ships a checksum that CI verifies.
- **CI does not run install scripts** (`npm ci --ignore-scripts`). If a
  dependency needs its install script, name it in the workflow with the
  reason.
- **Node** has an exact version in `.nvmrc`. `engines` and `devEngines` in
  `package.json`, and `engine-strict=true` in `.npmrc`, refuse a local
  install on an older Node major. When the major changes, change `.nvmrc`,
  `engines` and `devEngines` in the same change. CI fails a pull request when
  `.nvmrc` is outside the range of `engines` or `devEngines`, or when the
  lower bound of a range is on a different major. CI warns on a pull request,
  and fails each month, when `.nvmrc` is behind the newest patch of its line.
  Move the major of `@types/node` with `.nvmrc`, not before it.
- **Pin each action to a commit SHA**, with the version in a comment after
  it. Dependabot reads the comment and updates the SHA and the comment
  together. The owner of a tag can move it while a job holds a checkout.

## In this repository

### Pins that move by hand

| Pin | Where | Why by hand | How to move it | The check |
|---|---|---|---|---|
| `pcre2-wasm-utf16` commit | `package.json`, and `pcre2.wasm.sha256` at the root | A git dependency is pinned by commit, and the update bot does not move it. | A new release of the module: see below. | `node scripts/check-wasm-checksum.mjs` |

### Overrides

Each override has a reason and an issue that removes it.

| Override | Why | Drop it when |
|---|---|---|
| `typed-rest-client` → `qs` `^6.16.1` | Stryker's `typed-rest-client` pins `qs` 6.15.1 exactly, inside two denial-of-service advisories. A development dependency only. | Stryker depends on a fixed `typed-rest-client` ([#14](https://github.com/Bimmiest/propslab-engine/issues/14)). |

`minimatch` 10.2.6 stays inside GHSA-g3hv-75wg-m249 (development only). Only
`minimatch` 11 fixes it, and an override to 11 stops ESLint, because
`eslint-plugin-import-x` imports `makeRe`, which `minimatch` 11 removed.

### The regex engine's binary

The module lives in its own repository,
[`Bimmiest/pcre2-wasm-utf16`](https://github.com/Bimmiest/pcre2-wasm-utf16).
That repository commits `pcre2.wasm`, built from a pinned PCRE2 release, and
its CI builds it again and fails unless the result is the same byte for
byte. To change it, make the change there and tag a release. Then, in one
pull request here:

1. Move the commit in `package.json` to the commit of the tag.
2. Copy the release's `pcre2.wasm.sha256` to the root.
3. Run `npm install` and the gates.

The lockfile records no integrity hash for a git dependency, and `npm audit`
cannot see it. Thus CI compares the installed binary with the checksum that
the package ships, and with the one at the root.

**The consumers follow this pin.** They ship the module, and they read the
same checksum from this package (`propslab-engine/pcre2.wasm.sha256`). A
consumer's own pin of `pcre2-wasm-utf16` is the commit that this package
declares, and propslab has a test that holds it there.
