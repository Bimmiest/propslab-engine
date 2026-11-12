---
type: reference
---

# Using the engine as a library

The engine is logic with no UI. It runs with no change in a browser, in a Web
Worker and under Node. Its one runtime dependency is the PCRE2 WebAssembly
module, which runs each pattern that a user writes. Load that module one time,
before the first run ([the regex engine](#the-regex-engine)). `runPipeline` is
the entry point:

```text
runPipeline(rawData, metadata, propsConfInput, transformsConfInput, options?)
```

`options` is `PipelineOptions`:

| Option | Default | What it does |
|---|---|---|
| `perEventPipeline` | — | Matches the stanzas for each event, and not one time for all the events. Thus a metadata rewrite in a transform changes the stanzas of the search-time stages. |
| `captureOffsets` | `true` | Records the position of each capture of an `EXTRACT` in `fieldOffsets`. |
| `now` | `Date.now()` | The current time, in epoch milliseconds. It is the clock for each thing that Splunk measures against the clock: the bounds `MAX_DAYS_AGO` and `MAX_DAYS_HENCE`, the year of a `TIME_FORMAT` that has no year, the `_time` of an event with no timestamp, and eval's `now()` and `time()`. |
| `limits` | `DEFAULT_LIMITS` | Bounds on the work of a run (`RunLimits` in `runContext.ts`). Give any of them. See [the limits of a run](#the-limits-of-a-run). |
| `onStage` | — | `(stage, events) => void`. The engine calls it when each stage starts, with the name of the stage (one of `RUN_STAGES` in `runStages.ts`) and the number of events. The MCP server uses it to say where a stopped run was. It must not throw. |

**Give `now` when you replay recorded data.** A recorded sample has absolute
timestamps. After some years, `MAX_DAYS_AGO` (2000 days by default) refuses
them, and the output changes only because of the date. Set `now` to the time
of the recording, and the result stays the same.

### The limits of a run

| Limit | Default | When the run gets to it |
|---|---|---|
| `maxRawChars` | 1,000,000 | The engine cuts the input at the last complete line before the limit. A warning says so. |
| `maxEvents` | 25,000 | Line breaking stops, and the engine drops the rest of the input. A warning says so. |
| `explanationsPerDirective` | 50 | The engine stops the analysis of the events that a directive did not match ([no-ops](#the-cost-of-a-no-op)). |
| `maxRunMs` | no limit | The stages stop at the next regex call, and an error names the stage. |

## Conf layers (`default/` and `local/`)

> **Only the API.** The editors of propslab's app hold one props.conf and one
> transforms.conf, with no layers. Thus the app cannot use this section yet.
> [propslab#132](https://github.com/Bimmiest/propslab/issues/132) and
> [propslab#86](https://github.com/Bimmiest/propslab/issues/86) track this.

`parseConf`, and thus `runPipeline`, accept the text of one conf, or a list of
layers. Put the layer with the lowest precedence first. A caller that reads an
app from disk gives `$APP/default/props.conf` and then
`$APP/local/props.conf`:

```ts
import { runPipeline } from 'propslab-engine';

runPipeline(
  raw,
  metadata,
  [
    { layer: 'default', text: defaultProps },
    { layer: 'local', text: localProps },
  ],
  [
    { layer: 'default', text: defaultTransforms },
    { layer: 'local', text: localTransforms },
  ],
);
```

`layer` is a label of your choice, for example `app/local` or `system/local`.
The engine keeps it as provenance. The order of the list sets the precedence,
because only the caller knows how its layers rank.

The merge is for each attribute in a stanza, not for each file. A `local`
stanza replaces only the attributes that it names. The other attributes of the
`default` stanza stay. This is the result of a simple rule: in a stanza, the
last value of a key wins.

Layered input adds provenance to the result:

- Each `ConfDirective` has the `layer` that it came from. This is also true for
  the directives that `mergeDirectives` returns. Thus you can find the file
  that set each attribute.
- The value that wins a key has `overrides`, nearest first. `overrides[0]` is
  the value that applies if you delete the line that won. Each value that lost
  has `overriddenBy`.
- Each `ConfStanza` has `layers`: each file that defines it, lowest first. Its
  `layer` and `lineRange` name the file with the highest precedence.
- Each diagnostic for a directive or a stanza has `layer` and `line`, because
  two files can each have a line 7.

A string gives the same result as before, with no provenance. One layer gives
no merge. Layered input and stanza precedence
([pipeline.md](pipeline.md#stanza-precedence)) are the two halves of what
`btool … --debug` shows: the stanza that won, and the file that set each
value.

The merge is in one stanza only. A directive that wins in its stanza can lose
to a stanza with a higher precedence. `matchStanzas` and `mergeDirectives`
decide that.

## The regex engine

Each pattern that a user writes runs on **PCRE2, compiled to WebAssembly**,
through `src/utils/splunkRegex.ts`. These are the patterns:

- `LINE_BREAKER`, `BREAK_ONLY_BEFORE`, `MUST_BREAK_AFTER` and `TIME_PREFIX`
- `EXTRACT`, the `REGEX` of a transform, and `SEDCMD`
- `FIELD_HEADER_REGEX` and the other patterns of `INDEXED_EXTRACTIONS`
- eval's `match()`, `replace()`, `like()` and `mvfind()`
- the stanza patterns `[source::…]` and `[host::…]`, which Splunk reads as
  PCRE.

Splunk's regexes are PCRE. Thus the engine runs the same regex engine as
Splunk, and not a translation into JavaScript. Each consumer compiles through
this one module, so two consumers cannot disagree about what a pattern means.
The engine's own patterns (strftime formats, date recognition) stay JavaScript
regexes.

The module is [`pcre2-wasm-utf16`](https://github.com/Bimmiest/pcre2-wasm-utf16),
pinned to a commit. It is PCRE2 10.48, the 16-bit library in UTF mode, built
from the pinned release by its `build/build.sh`, with clang and `wasm-ld`. Its
offsets are UTF-16 code units, which are the indexes of a JavaScript string.
Its README gives its API and its build.

### Initialising it

The engine API is synchronous, but a WebAssembly module must be compiled
before its first use. Do it one time, before the first pattern compiles:

```ts
import { initRegexEngine, initRegexEngineSync } from 'propslab-engine';

// Node, or a worker: synchronous is fine.
initRegexEngineSync(readFileSync(createRequire(import.meta.url).resolve('pcre2-wasm-utf16/pcre2.wasm')));

// A browser's main thread: asynchronous.
await initRegexEngine(WebAssembly.compileStreaming(fetch(wasmUrl)));
```

A pattern that compiles before this throws an error. `runPipeline` stays
synchronous.

How propslab loads the module:

- **The page** loads it before its first render.
- **Each Web Worker** loads its own copy from the same fixed URL on the same
  origin, before it says that it is ready ([propslab's
  architecture.md](https://github.com/Bimmiest/propslab/blob/main/docs/architecture.md#workers)).
  A worker never takes the module from a message. Otherwise the data of a
  message can choose the code that the worker compiles.
- **The MCP server** compiles it one time for each process, and gives it to
  each worker that it starts. The compile is not part of the time budget of a
  request.

Measured with no cache: the compile takes 2–7 ms in Chromium with no head, and
about 1 ms in Node. V8 compiles WebAssembly lazily, with its baseline
compiler. When the optimising compiler compiles the whole module first
(`--no-liftoff --no-wasm-lazy-compilation`), it takes 380–470 ms in Chromium
and about 200 ms in Node. In propslab's end-to-end suite, the fetch, the
compile and the instantiation of the page took 76 ms together, against a
budget of 2 s.

A browser needs `'wasm-unsafe-eval'` in the `script-src` of the
Content-Security-Policy. It lets the page compile WebAssembly, and nothing
more.

### Semantics

The engine does what PCRE does, not what a JavaScript regex does:

- `$` also matches before a final newline. `\z` is the end. `\Z` is the end, or
  the position before a final newline. `\A` is the start, also with `(?m)`.
- The newline is LF. Thus `.` matches `\r`.
- Possessive quantifiers, atomic groups, recursion, conditionals, `\K`, `\G`,
  `\Q…\E`, POSIX classes, `\h`, `\v`, `\R`, Unicode properties (`\p{…}`), and
  inline options at any position, for the group that holds them.
- The engine compiles patterns in UTF mode, with no UCP. Thus `.` is one
  character, also an astral character. `\w`, `\d`, `\b` and the POSIX classes
  are ASCII, as in Splunk. `(*UCP)` selects the Unicode classes. A lone
  surrogate in a subject matches as U+FFFD.
- A global search (`REPEAT_MATCH`, search-time `REPORT`, `SEDCMD …/g`, eval
  `replace()`) follows the rule of PCRE2. After an empty match, the next try
  starts at the same position, and it cannot be empty, as in Perl. JavaScript
  moves forward by one code unit instead.
- A capture group in a repeated group keeps the value of the last repeat that
  set it.

The syntax of a replacement is not PCRE2's. Splunk does not use
`pcre2_substitute`. Thus each directive expands its own template from the
groups of the match:

- `SEDCMD`: sed's `\1` and `&`
- the `FORMAT` of a transform: `$1` and `$0`
- eval `replace()`: `\1`.

### MATCH_LIMIT and DEPTH_LIMIT

`EXTRACT` runs with the `MATCH_LIMIT` and `DEPTH_LIMIT` of its props.conf
stanza. `REPORT` and `TRANSFORMS` run with the limits of their transform
stanza. If a stanza does not set them, they are Splunk's defaults, 100000 and
1000, and 0 means no limit.

- A match that gets to a limit is no match, as in Splunk. A diagnostic names
  the limit.
- A search for each match (a global `SEDCMD`, eval `replace()`, a search-time
  extraction, or `REPEAT_MATCH`) can get to a limit after some matches. It
  keeps the matches before the limit, and a warning names the directive and
  says that the result is not complete.
- The patterns outside field extraction run with the defaults of PCRE2: ten
  million each. The memory for backtracking is 64 MiB or less for each match.

Two cautions. Each comes from PCRE2, because the limits got their names in
PCRE1:

- **The count is the count of the interpreter.** WebAssembly has no JIT, so
  each match runs the interpreter of `pcre2_match`. The JIT of PCRE2 counts
  the same limit in a different way. The engine models the interpreter.
- **`DEPTH_LIMIT` is approximate.** PCRE1's `match_limit_recursion` counted
  recursion on the C stack. PCRE2 counts frames of backtracking on the heap.
  Thus the same `DEPTH_LIMIT` stops a pattern at a different depth.

### Known differences from Splunk's PCRE

Splunk documents its regexes as PCRE. Where PCRE2 and PCRE1 are different, the
engine does what PCRE2 10.48 does. It does not copy PCRE1:

- `\K` in a lookaround is a compile error in PCRE2 10.38 and later. PCRE1
  accepted it.
- PCRE2 accepts a lookbehind of variable length, when each branch has a bound
  of 255 characters or less. PCRE1 needed each branch to have a fixed length.
  A pattern that uses this compiles here, and possibly not in Splunk.
- The error messages are the words of PCRE2.
- The limits count in a different way, as above.

Use the syntax that PCRE1 and PCRE2 share. Compare a pattern that needs newer
syntax with a real indexer.

### The bounds of a run

The limits of PCRE2 bound each match, but not a run. Many events with many
patterns can take seconds, while each match stays in its limits. Set
`limits.maxRunMs` to bound a run. After that time, the stages stop at the next
regex call, and an error names the stage
([propslab ADR 0019](https://github.com/Bimmiest/propslab/blob/main/docs/adr/0019-a-run-stops-at-its-time-budget.md)).
A `MATCH_LIMIT` or `DEPTH_LIMIT` of 0, or of more than 10,000,000, becomes
10,000,000. Thus one match takes approximately 0.2 s or less.

**A consumer that runs patterns that it did not write must use a thread that
it can stop.** A run can go past its budget by one match, and by work that
uses no regex. propslab does this:

- The app sets `maxRunMs` to 4 s. It runs the pipeline, the Regex and
  Timestamp tabs and the `TIME_FORMAT` hover in workers, each with a watchdog.
- The MCP server stops its worker at the `timeout_ms` of the call.

The ReDoS heuristic (`src/utils/redosHeuristic.ts`) does not refuse a pattern,
because Splunk does not refuse a valid pattern. The MCP server uses it only to
put the patterns of its timeout report in order.

The cost of PCRE2, measured in Node on 20,000 synthetic key-value events (two
`EXTRACT`s, a `REPORT` with `MV_ADD`, a `SEDCMD` and a `TIME_PREFIX`):

- The pipeline took 2.3 s on PCRE2, and 1.7 s on V8's irregexp.
- The two examples of propslab, made as large as the 1 MB limit, took 0–25%
  more time.
- A typical `EXTRACT` takes approximately 1.8 µs for each event, and 1.4 µs
  on irregexp.
- In the browser, propslab's paste of 20,000 events (`e2e/perf.spec.ts`) ran
  its pipeline in approximately 2.7 s, and in 2.5 s before, on the same
  machine.

### The cost of a no-op

The engine explains a directive that did nothing (`event.noOps`), and this
work has a bound for each run too. For a pattern that did not match, the
engine finds how far the pattern got. This costs approximately log(atoms)
more regex runs. The engine does it for the first 50 events that each
directive does not match in a run. After that, a miss of the directive has
`{ kind: 'not-explained' }`, not `{ kind: 'no-match', … }`. `describeNoOp`
shows it as "Not analysed: explanation limit reached for this directive". A
caller that groups no-ops counts these events apart from the events with an
explanation, as `groupNoOps` does.

The table of formats for automatic timestamp recognition
(`timestampRecognizer.ts`) stays on JavaScript regexes. The engine makes these
patterns from strftime formats, a user does not write them, and they run on
each line.

## Running the engine under Node

`captureOffsets: false` does not record the positions of the captures. Use it
if you do not show highlights. It does not change the regex engine of a
pattern.

The V8 flags `--enable-experimental-regexp-engine-on-excessive-backtracks
--regexp-backtracks-before-fallback=1000` protect only the engine's own
JavaScript regexes, which have fixed shapes. User patterns do not run on V8's
regex engine.

[propslab's `packages/mcp-server`](https://github.com/Bimmiest/propslab/blob/main/packages/mcp-server)
is a Node consumer of this kind. Each engine run is in a `worker_threads`
worker, with a time budget and a hard stop. The server compiles the regex
engine one time, and gives it to each worker.
