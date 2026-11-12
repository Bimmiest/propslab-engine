// @ts-check
// Mutation testing (propslab#370): `npm run test:mutation`. Coverage
// says a line ran; this says whether any test would notice the line being
// wrong. See docs/testing.md for how to read a run and when CI runs it.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  // The file says what it changes from vitest.config.ts.
  vitest: { configFile: 'vitest.stryker.config.ts' },

  // The engine is where correctness lives, so all of it is mutated. Left out:
  // type-only modules (no code to mutate), the shared test scaffolding, and the
  // generated or hand-written data tables — the directive registry, the CIM
  // models and the support roster — whose mutants are edits to description
  // prose that no behavioural test should be asserting.
  mutate: [
    'src/**/*.ts',
    '!src/**/__tests__/**',
    '!src/**/*.test.ts',
    '!src/test/**',
    '!src/index.ts',
    '!src/types.ts',
    '!src/scaffold/types.ts',
    '!src/cim/cimModelsData.ts',
    '!src/registry/**',
    '!src/directiveSupport.ts',
  ],

  // Each mutant runs only the tests that reached it — the difference between
  // an hour and most of a day.
  coverageAnalysis: 'perTest',
  // A "static" mutant changes a module-level value (a regex constant, a lookup
  // table) that is built once at import, so no single test can be said to cover
  // it and Stryker has to rerun the whole suite for each. There are about 900.
  // The full run in CI includes them: mutation.yml sets MUTATION_STATIC=1, and
  // they add about 40 minutes of work, split across its shards (propslab#857). A PR run
  // and a local run skip them, to stay fast, and report them as Ignored;
  // `MUTATION_STATIC=1 npm run test:mutation -- --mutate <file>` runs them when
  // you change one of those constants.
  //
  // An environment variable, because Stryker's `--ignoreStatic` flag can only
  // switch the option on: `--ignoreStatic false` reads `false` as the path of a
  // config file and fails.
  ignoreStatic: process.env.MUTATION_STATIC !== '1',

  reporters: ['clear-text', 'progress', 'html', 'json'],
  // The score table, not the thousands of individual survivors: those are what
  // the HTML report (reports/mutation/mutation.html) is for.
  clearText: { reportMutants: false, reportTests: false },

  // `break` is the floor: below it the run exits non-zero, which is what fails
  // the mutation workflow. Measured, not chosen: 3 points under the 84.90% the
  // whole engine scored on 2026-10-26, the slack the coverage ratchet uses. At
  // 1.6 points, one change that killed fewer mutants turned the weekly run red
  // with no PR to blame (propslab#571). Raise it when tests raise the score; never lower
  // it to make a branch green.
  //
  // `low` is the edge of the warning band: a score between `break` and `low`
  // passes but is flagged in the report. It sat at `break`, so the band was empty
  // and the first sign of a slide was a red build (propslab#508). Now a few points
  // above, so a run drifting toward the floor is visible before it fails.
  //
  // A shard of the weekly run (MUTATION_SHARD=1) has no floor of its own:
  // scripts/check-mutation-score.mjs holds the shards' combined score to
  // `break` (propslab#851). One shard alone can be below the floor while the run is not.
  thresholds: { high: 85, low: 83, break: process.env.MUTATION_SHARD === '1' ? null : 81 },
};
