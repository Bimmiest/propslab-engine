---
type: how-to
---

# Recipes

Where each change goes, the steps for a simulated directive, and the recipes
for the usual changes. [CONTRIBUTING.md](../CONTRIBUTING.md#the-engine) has
the summary of the rules.

## Where a change goes

| What | Where |
|---|---|
| The logic of the simulation | `src/`: no UI, and it runs under Node and in a Web Worker |
| The data of a directive (description, default, phase, valid values) | `src/registry/`, which `src/directiveRegistry.ts` assembles |
| Whether the engine honours a directive | `src/directiveSupport.ts` |
| What a consumer can import | `src/index.ts` |

A pattern that a user wrote compiles through `safeRegex` in
`src/utils/splunkRegex.ts`, never `new RegExp`. This keeps each consumer on
the regex semantics of Splunk. The engine's own fixed patterns (wildcards,
strftime formats) stay JavaScript regexes.

The code of each directive expands its replacement template (`SEDCMD`,
`FORMAT`, eval `replace()`) from the groups of the match. Do not use the
substitution syntax of PCRE2. Splunk does not use it.

A name that `src/index.ts` exports is public. propslab, propslab-sb and
propslab-ent import from it. Before you remove or rename one, search those
repositories too. A search of one repository found `FALLBACK_TIME_SOURCES`
unused, and its removal broke two others (propslab#570).

## Adding or changing a simulated directive

This part has rules of its own, because the engine claims that its output is
the output of Splunk.

1. **Implement it in `src/`**, with a unit test that asserts the behaviour.
2. **Classify it in `directiveSupport.ts`** as `simulated`, `documented` or
   `ignored`. A test fails when a key of the registry has no class. Another
   test fails when no engine test gives a `simulated` key to `runPipeline`.
   That test reads the confs that the tests give to the pipeline, not the
   source of the tests. An `ignored` directive needs an issue that tracks it.
3. **Assert against the documentation, and say so.** Some old bugs came from
   a sensible reading of `props.conf.spec` that real Splunk contradicts. Thus
   a test from the documentation can assert a wrong answer. Keep the
   assertion narrow.
   - Put the citation in one comment block. It says "Doc-derived", and it
     names the spec (`props.conf.spec` or `transforms.conf.spec`) and the
     directive.
   - Put it in a test file that runs the directive through `runPipeline`.
     `docDerivedDirectives.test.ts` is the place for these tests at the level
     of the pipeline.
   - The directive must be in a stanza that applies to the run. A props
     stanza that matches no metadata of the run does not count. A transforms
     stanza that no applied props stanza names does not count.
   - `directiveEvidence.test.ts` fails on a `simulated` directive with no
     citation. The only other choices are the class `documented`, or an
     entry in its `DOC_UNCITED` list, which must not get longer. The check
     runs only in a full run (`npm test`) and in CI.
4. **If real Splunk contradicts a test from the documentation,** open a
   fidelity question with the input, the stanza and what Splunk produced.
   Thus a wrong reading gets a fix with no recording in this repository.

## Changing behaviour that a test asserts

An issue can show that Splunk produces a result that a test from the
documentation contradicts. Then change the engine and the test together. Add
a comment that names the issue, and gives the old reading. Some tests have
this note already.

## Add a directive

1. Add a `DirectiveInfo` entry to the props or the transforms data file in
   `src/registry/`. A new entry goes in `propsDirectives.ts` or
   `transformsDirectives.ts`. The `*SpecDirectives.ts` files hold the sweep of
   the spec. `directiveRegistry.ts` assembles them. Then each consumer's
   completion, hover, lint and dictionary get the new entry.
2. If it needs a processor, make or change one in `src/processors/`. Connect
   it to `src/pipeline.ts` at the correct position, in `safeProcessor()`.
   - The processor reads the clock, the limits and the diagnostics of the run
     from the `RunContext` that it gets (`src/runContext.ts`). It has no
     defaults of its own.
   - A warning that must show one time in a run goes through
     `ctx.diagnostics.report(key, …)`, not through a set in the function.
3. Follow the rules for the class and the citation above. The tests of the
   support table enforce them.

## Add an eval function

Add a `case` to the `evalBuiltin` switch in `src/processors/eval/builtins.ts`.
A function that evaluates only some of its arguments (for example `if` or
`coalesce`) goes in `evalCall` in `eval/evaluator.ts`.

## Add or update a CIM model

A script makes `CIM_MODELS` in `src/cim/cimModelsData.ts`. Do not change the
file by hand. To make it again, download the CIM add-on from
[Splunkbase](https://splunkbase.splunk.com/app/1621), extract it, and run:

```bash
node scripts/generate-cim-models.js /path/to/Splunk_SA_CIM
```

The script reads `default/data/models/*.json`, the definitions of the models
that Splunk runs. It reads `CIM_VERSION` from the `app.conf` of the add-on.

- The `INCLUDE` table at the top of the script selects the datasets and gives
  their labels.
- The script reads the rest from the add-on: the fields, which fields are
  required and which are recommended, and the tags of each constraint.
- A dataset that Splunk renamed or removed fails the run. It does not
  disappear with no message.
- Nothing runs this script when you build or install. This repository does
  not hold the add-on.

CI cannot run the script. The add-on needs a Splunkbase login, and its
licence is Splunk's. `src/__tests__/generateCimModels.test.ts` tests what does
not need the add-on:

- the transformation, on a small add-on in `src/__tests__/fixtures/cim`, with
  models that we made and no content from Splunk
- the format of the output: `render()` must write the committed
  `cimModelsData.ts` byte for byte from its contents.

A person must still compare the field lists with a newer add-on. Run the
script, and read the diff.

To add a dataset by hand, first read the rules in the header of the file that
the script made. The fields must come from the JSON of the model, not from
memory or from the prose of the documentation:

```typescript
{
  name: 'Your_Model',          // or 'Your_Model.Dataset' for a second root dataset
  displayName: 'Your Model',
  description: 'Description',
  requiredFields: ['field1', 'field2'],
  recommendedFields: ['field3'],
  tags: ['your_tag'],          // ALL tags must be present for the dataset to populate
}
```
