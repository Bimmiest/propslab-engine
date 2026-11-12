# Security policy

## How to report a vulnerability

Report it privately through the
[private vulnerability reporting](https://github.com/Bimmiest/propslab-engine/security/advisories/new)
of GitHub: open the **Security** tab, then select **Report a vulnerability**.
Do not open a public issue for a security problem.

You get an acknowledgement within a week. If the report is valid, the fix
and the advisory are published together.

## What this library is

propslab-engine is a library with no I/O. It reads text that its caller gives
it (a raw log, a `props.conf`, a `transforms.conf`) and returns a result. It
makes no network calls, reads and writes no files, and stores nothing. Its
callers give it text that a user wrote, and some run it on configs that an
LLM agent wrote ([propslab's MCP server](https://github.com/Bimmiest/propslab/tree/main/packages/mcp-server)).
Thus the attack surface is the input text, and what the engine does with it.

## In scope

- **Prototype pollution** through field names. Extracted names come from the
  input and go into plain objects. `src/utils/fieldBag.ts` makes that safe,
  and a bypass of it is a finding.
- **Denial of service through a pathological regular expression.** Each user
  pattern runs on PCRE2, whose match and depth limits stop a runaway match.
  The engine caps both at 10,000,000, and `limits.maxRunMs` stops a run at
  its budget ([docs/api.md](docs/api.md)). A pattern that gets past these is a
  finding. A pattern that is only slow is expected: a caller runs the engine
  in a thread that it can stop.
- **The PCRE2 WebAssembly module.** It comes from
  [`pcre2-wasm-utf16`](https://github.com/Bimmiest/pcre2-wasm-utf16), pinned
  by commit, and CI checks its checksum. A memory-safety bug in PCRE2 stays
  in the module's own linear memory. A way to corrupt the engine's results or
  to escape that memory is in scope.
- **Vulnerabilities in dependencies** that the code of this application can
  reach. CI audits the production dependencies on each pull request and each
  week.
- **Secrets in the repository or its history.** CI scans the full history on
  each pull request and each week. A secret that CI finds is rotated, not
  allowlisted.

## Out of scope

- **Correctness bugs** that are not vulnerabilities. Report them as usual
  issues, with a minimal reproduction if you can.
- **How a consumer shows the result.** The engine returns text from the
  input as it is. Escaping it for a page is the consumer's job: report a
  cross-site scripting problem to that consumer.

## Supported versions

Fixes go to `main`. There is no support branch for older releases.
