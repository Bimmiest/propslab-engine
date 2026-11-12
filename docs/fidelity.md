---
type: reference
---

# Simulation fidelity

The correctness oracle of a simulator is "matches real Splunk". That target is closed-source, versioned and partly undocumented. Thus it is not possible to _prove_ that the fidelity is complete, but it is possible to give it a boundary. This file gives that boundary in one place:

- what the engine simulates
- what it does not simulate, on purpose
- where the simulation knowingly diverges from Splunk.

If an output looks suspicious, verify it against a real indexer before you rely on it.

**Not simulated.** These items are out of scope on purpose, or are stubs:

- Lookups (`LOOKUP-*` directives and lookup tables)
- Input-layer directives (`EVENT_BREAKER`, `EVENT_BREAKER_ENABLE`, `CHARSET`, `NO_BINARY_CHECK`, `LEARN_SOURCETYPE`)
- Segmentation (`SEGMENTATION`, which changes search-time term segmentation, not the event output)
- Search-time optimization (`CAN_OPTIMIZE`, `OPTIMIZE_IE_EXTRACT`)
- Line-breaker lookbehind across chunk boundaries (`LINE_BREAKER_LOOKBEHIND`)
- Stub eval functions (`md5()`, `sha1()`, `sha256()`, `sha512()`). These are partial stubs: `searchmatch()`, `relative_time()`, `strptime()`, `mvfilter()`, `sigfig()` and `exact()`.

This repository does not distribute recorded outputs from Splunk Enterprise. These outputs are not part of its source, test suite, build, CI or releases. The tests assert against the documentation, and they say so ([propslab ADR 0016](https://github.com/Bimmiest/propslab/blob/main/docs/adr/0016-recorded-splunk-output-is-not-distributed.md)). The private fidelity suite holds the tests that need a recording ([testing.md](testing.md#in-this-repository)).

## Support levels

Each directive that the registry knows has one of three support levels: **simulated**, **documented** or **ignored**. [`src/directiveSupport.ts`](../src/directiveSupport.ts) declares them. The [Overview of the README](../README.md#overview) gives the table of the levels, with the number of directives at each level. A test asserts the counts against the table itself, so they cannot become incorrect.

A fourth state is outside that table. It is for attributes that the registry does not know at all. Such an attribute is valid in Splunk but unknown here, so the engine does not honour it and says nothing about it. The README also gives the number of these attributes, and a test holds it to `UNDOCUMENTED_ATTRIBUTES`. [propslab#178](https://github.com/Bimmiest/propslab/issues/178) closed that gap, because it registered each attribute in `props.conf.spec` and `transforms.conf.spec` for Splunk 10.4.3. Thus a valid directive always has a classification, also when it is not simulated.

The project maintains the registry by hand on purpose, and does not generate it. Conf attributes change rarely between versions. A generator needs `.spec` files, and this project has no licensed route to them. `UNDOCUMENTED_ATTRIBUTES` in [`src/directiveSupport.ts`](../src/directiveSupport.ts) stays as the place for the next unknown attribute. It holds only the name, because value types and defaults are facts that belong to the spec. A value type or a default that is a guess is a confident wrong answer.

A directive that is not `simulated` gets a diagnostic: a warning for `ignored`, and an informational note for `documented`. The registry entry says the same thing, and a consumer shows it, for example in an editor hover. Thus a result never looks as if a line that the user wrote does not exist.

One `simulated` entry has a caveat. `INDEXED_EXTRACTIONS` simulates csv, tsv, psv, w3c, json and the xml family (`xml`, `xmlkv`, `xmlkv-winevt`), with the attributes that support them. It does not simulate `hec`. `props.conf.spec` does not specify how the xml modes name their fields. The names come from `KV_MODE = xml` and the `xmlkv` search command, and the entry says so.

## Not simulated yet (`ignored`)

Each of these is a directive that the engine accepts and then does not honour. Each one is a known wrong answer. The roster is in [`src/directiveSupport.ts`](../src/directiveSupport.ts). Each `ignored` entry states what the simulation does not do, and names the issue that tracks it. The same text is the warning of the directive and the note of its registry entry.

A [scheduled workflow](../.github/workflows/roster.yml) checks that those issues are still open. An entry that points to a closed issue is how this roster becomes incorrect.

The roster is empty. The last entries were the index-time surface that [propslab#178](https://github.com/Bimmiest/propslab/issues/178) found when it completed the registry against the 10.4.3 spec files:

- XML indexed extraction ([propslab#271](https://github.com/Bimmiest/propslab/issues/271))
- the header-side delimited overrides ([propslab#272](https://github.com/Bimmiest/propslab/issues/272))
- the index-time timestamp fields ([propslab#273](https://github.com/Bimmiest/propslab/issues/273))
- `KV_TRIM_SPACES` and `JSON_TRIM_BRACES_IN_ARRAY_NAMES` ([propslab#274](https://github.com/Bimmiest/propslab/issues/274))
- rulesets, `STOP_PROCESSING_IF` and age-based routing ([propslab#275](https://github.com/Bimmiest/propslab/issues/275)).

All of them are simulated now. `OPTIMIZE_IE_EXTRACT` and `CAN_OPTIMIZE_IE` moved to `documented` instead. They skip work for the fields that a specific search asks for, and the engine runs no search. The roster check continues to run, and it fails again on the day that an entry returns.

## Deliberately out of scope (`documented`)

- **Lookups.** `LOOKUP` and each `transforms.conf` lookup attribute need a lookup table. The input of a run has no lookup table. The engine parses `LOOKUP-*` directives and gives a warning, but fields from lookups do not appear.
- **The forwarder and input layers.** `EVENT_BREAKER`, `EVENT_BREAKER_ENABLE`, `CHARSET`, `NO_BINARY_CHECK` and `LEARN_SOURCETYPE` belong to these layers. The layers are upstream of all that the engine simulates.
- **`SEGMENTATION`** changes how the indexer segments terms for search. It does not change the event or its fields.
- **`CAN_OPTIMIZE`** lets the search optimiser skip a transform, which changes no result.
- **`LINE_BREAKER_LOOKBEHIND`** sets the distance of the Splunk lookbehind across an internal chunk boundary. The simulator holds the whole input in memory, and it has no chunk boundaries to look across.
- **`CHECK_FOR_HEADER`** has a replacement: Splunk deprecated it in favour of `INDEXED_EXTRACTIONS`, which is simulated.

## Stubbed eval functions

The directive levels above do not apply to eval _functions_. The functions have their own boundary:

- **Crypto functions.** `md5()`, `sha1()`, `sha256()` and `sha512()` return a placeholder string (for example, `[md5() not simulated]`), and they emit a warning.
- **Partial stubs.** `searchmatch()`, `relative_time()`, `strptime()`, `mvfilter()` and `sigfig()` / `exact()` have simplified implementations. `mvfilter()` returns its input without a filter. `sigfig()` and `exact()` return the value, and they do not round it.

  In edge cases, the results can be different from Splunk. Each of these functions emits a warning when it is evaluated. Thus a stub result is never mistaken for a computed result.

- **Functions with no implementation.** Splunk has more eval functions, for example `printf()`, `lookup()`, the `json_*` functions, the trigonometric functions and the `bit_*` functions. Each of these returns null and emits the same warning. `UNSIMULATED_FUNCTIONS` in `builtins.ts` lists them.
- **A name that is not an eval function.** Splunk fails the expression, and the engine does the same. The EVAL writes no field, and an error names the function ([propslab#876](https://github.com/Bimmiest/propslab/issues/876)).

## Simplified

- **`SEDCMD` occurrence flag.** The `s/` substitute form and the `y/` transliterate form are both simulated. Each of these emits a warning, and the engine does not drop it silently:
  - the numeric occurrence flag (`s/…/…/2`)
  - a value that is not a sed expression
  - a `y///` with two character sets of different lengths
  - a pattern that does not compile.
- **Delimited `INDEXED_EXTRACTIONS` overrides apply to `csv`/`tsv`/`psv` only.** The engine honours these overrides for the delimited formats: `FIELD_DELIMITER`, `FIELD_QUOTE`, `FIELD_NAMES`, `HEADER_FIELD_LINE_NUMBER`, `PREAMBLE_REGEX`, `FIELD_HEADER_REGEX`, the header-side delimiters (`HEADER_FIELD_DELIMITER`/`HEADER_FIELD_QUOTE`) and `MISSING_VALUE_REGEX`. `w3c` keeps its own `#Fields` header mechanism, and the overrides do not change it there.

  The engine also honours `TIMESTAMP_FIELDS` for `json` and `w3c`. Without it, `w3c` reads its timestamp from the `date` and `time` columns, not from any other part of the row. In this context, `KEEP_EMPTY_VALS`/`CLEAN_KEYS` are not implemented. The `CLEAN_KEYS` of transforms.conf itself **is** simulated.

- **`priority` rules come from the documentation.** `priority` orders stanzas _within_ a kind, and it cannot reach across kinds. `source` > `host` > `sourcetype` > `default` is always true, whatever a stanza declares, and `props.conf.spec` says this explicitly. If a stanza declares no `priority`, its default depends on how it matches, not on its kind:
  - 100 when the stanza matches literally (`[my_sourcetype]`, `[source::/var/log/app.log]`)
  - 0 when it matches by pattern (`[source::...app...]`, `[host::web*]`, and a host pattern with any regex syntax other than `.`, such as `[host::web\d+]`).

  Thus a pattern stanza needs a `priority` above 100 to beat a literal stanza of the same kind. The tests assert our interpretation of the documentation. On the question across kinds, the documentation contradicts itself one time ([propslab#198](https://github.com/Bimmiest/propslab/issues/198)). `sourcetype` and `rename` are in the same position, but their rules are less ambiguous.

- **`KV_MODE = xml`.** The engine's own XML reader (`src/utils/xmlReader.ts`) reads it, not `DOMParser`, because no Web Worker or Node process has `DOMParser`. The reader is as strict as a parser that conforms to the XML standard, so malformed XML extracts nothing. It does not expand entities that the internal subset of a DOCTYPE declares. The name of an element field is its dotted path from the document root, and this path includes the root (`<event><user>…` gives `event.user`). The Splunk 10.4.0 capture pins this.

  No capture pins the names of attributes. An attribute keeps its bare name. The exception is a `Name` attribute: it follows the Windows event-log convention, and it names the field itself.

- **`PAIR_RE` in transform `FORMAT` does not handle escaped quotes in quoted values.** `"([^"]*)"` stops at the first inner `"`, so `field::"say \"hi\""` parses as `field=say \`. The behaviour of real Splunk here is under-documented. Treat it as an edge case.

- **Time zone of `strftime()`.** Eval `strftime()` shows the time in the time zone of the host. The host is what runs the engine: a browser, a worker or a Node process. Thus the same input can give different output on two hosts in two zones (`%H` and `%Z` are examples). Splunk uses the time zone setting of the user, and the simulator does not model this setting. A run has an injected `now`, but no injected zone. To compare results, run both with the same `TZ`.

## Guesses that no recording confirms

The engine does these things in a way that no Splunk recording confirms. The note of each directive in the registry says the same.

- **`TIME_FORMAT` without `TIME_PREFIX`.** The engine reads the first match of the format anywhere in the `MAX_TIMESTAMP_LOOKAHEAD` window, not only at the start of the event.
- **Two `EXTRACT`s that give the same field.** The engine keeps the value of the first. It shows the second as a no-op. Splunk can give a multivalue field.
- **`SEDCMD` before `TRANSFORMS`.** The engine applies `SEDCMD` first. A `TRANSFORMS` that reads the text a `SEDCMD` changes can give a different result in Splunk.
- **`INGEST_EVAL` with `=` on a field that has a value.** The engine replaces the value, as `:=` does. The spec says that `=` adds the value to a multivalue field.
- **A bare number in `ROUTE_EVENTS_OLDER_THAN`.** The engine reads it as seconds. The spec does not give the default unit.

## Opt-in

- **Metadata rewrites with `DEST_KEY = MetaData:*`.** By default (batch mode), a write to `MetaData:Sourcetype` updates the metadata field of the event. But the search-time processors still use the original stanza match, and a warning says so. With `perEventPipeline: true`, each event goes through the pipeline alone, and a new `matchStanzas` + `mergeDirectives` pass runs after the index-time transforms. Thus the search-time directives come from the new sourcetype. propslab's app has this option in its Settings.

## Other

- **Regexes run on PCRE2, bounded by its limits and a run budget.** Each user pattern runs on PCRE2 compiled to WebAssembly. Thus the engine matches what the PCRE of Splunk matches, not a JavaScript translation of it. Examples are `$` before a final newline, `.` that matches `\r`, possessive quantifiers, recursion and `\K`. The engine refuses no pattern because it looks prone to catastrophic backtracking.

  `MATCH_LIMIT` and `DEPTH_LIMIT` bound each field-extraction match, as in Splunk. [api.md](api.md#the-regex-engine) gives more information. It also tells where PCRE2 differs from PCRE1, the version that gave these limits their names. The engine caps both limits at 10,000,000, the PCRE2 default. Thus `MATCH_LIMIT = 0` does not remove the limit, as it does in Splunk. Each stanza-pattern match (`[source::…]`, `[host::…]`) is held to the default `MATCH_LIMIT` and `DEPTH_LIMIT` of Splunk.

  The limits bound each match, not a whole run. `limits.maxRunMs` stops a run between two matches, and an error names the stage where it stopped. A run can go past its budget by one match, so a consumer that runs patterns that it did not write runs the engine in a thread that it can stop ([api.md](api.md)). propslab's app and its MCP server do this, and [propslab's fidelity.md](https://github.com/Bimmiest/propslab/blob/main/docs/fidelity.md) says how.

- **Raw data capped at 1 MB** (`limits.maxRawChars`). The pipeline _truncates_ the input at the last complete line. Thus it drops the partial event at the end, and does not break it incorrectly. A warning says so, and gives the line from which the input was dropped. Line breaking also stops at 25,000 events (`limits.maxEvents`). Without this limit, a `LINE_BREAKER` that breaks on each character makes a million events.

- **Sourcetype stanzas match by strict equality.** Real Splunk does the same, because sourcetype names are literal, with no wildcards. This note is here so that contributors do not add wildcard support by analogy with `source::` / `host::`.

[CHANGELOG.md](../CHANGELOG.md) gives the history of the fixes from this repository, and [propslab's CHANGELOG](https://github.com/Bimmiest/propslab/blob/main/CHANGELOG.md) the history before the move.
