import { configDefaults, defineConfig } from 'vitest/config';
import base from './vitest.config';

// The vitest config Stryker runs (`npm run test:mutation`, stryker.config.mjs).
// It is the normal one with two changes.
//
// 1. Only the tests of src/. The tests of the scripts cannot kill a mutant in
//    the engine.
//
// 2. None of the directive-evidence machinery. The base config records what
//    tests feed `runPipeline` (src/test/recordDirectiveEvidence.ts) for the one
//    test that reads it back, which needs the whole suite in one invocation
//    across two projects. A mutant run is neither, so the recorder is dropped,
//    the projects are collapsed to the single `include` below, and that test is
//    excluded.
delete process.env['PROPSLAB_EVIDENCE_DIR'];

// Spread rather than mergeConfig, which concatenates arrays and would ADD this
// include to the base one instead of replacing it.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    projects: undefined,
    // Instrumented code is slower, and a dry run that passes the normal
    // timeout stops the run before it mutates anything (propslab#728). Each
    // mutant still gets Stryker's own timeout, from the dry run's times.
    testTimeout: 120_000,
    setupFiles: (base.test?.setupFiles as string[] | undefined)?.filter((f) => !f.includes('recordDirectiveEvidence')),
    include: ['src/**/*.test.ts'],
    exclude: [
      ...configDefaults.exclude,
      'src/__tests__/directiveEvidence.test.ts',
      // Stryker writes `// @ts-nocheck` at the top of each file in its
      // sandbox, so the committed cimModelsData.ts is no longer what the
      // generator writes. The test checks the script, and kills no mutant.
      'src/__tests__/generateCimModels.test.ts',
    ],
  },
});
