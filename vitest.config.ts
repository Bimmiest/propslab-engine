import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

// Where src/test/recordDirectiveEvidence.ts leaves what each test file fed to
// runPipeline. This file is evaluated once, in the main process, and workers
// inherit the environment, so every file of one invocation shares one
// directory and two invocations never share one. The directory goes when the
// main process does.
//
// Only a full run records: `vitest run` with no file filter, project, shard,
// name pattern or changed-files selection. A partial run cannot judge the
// evidence, so it records nothing and directiveEvidence.test.ts skips rather
// than failing on what it did not see (propslab#569). CI always records, so a
// command line misread here cannot switch the gate off there.
const cliArgs = process.argv.slice(2);
const runAt = cliArgs.findIndex((arg) => arg === 'run' || arg === '--run');
const fullRun =
  runAt !== -1 &&
  cliArgs
    .slice(runAt + 1)
    .every(
      (arg) => arg.startsWith('-') && !/^(?:-t|--(?:project|shard|testNamePattern|changed|related|dir))\b/.test(arg),
    );
if (fullRun || process.env['CI']) {
  const evidenceDir = join(tmpdir(), `propslab-directive-evidence-${String(process.pid)}-${String(Date.now())}`);
  process.env['PROPSLAB_EVIDENCE_DIR'] = evidenceDir;
  process.once('exit', () => {
    rmSync(evidenceDir, { recursive: true, force: true });
  });
}

const UNIT_TESTS = ['src/**/*.test.ts', 'scripts/**/*.test.{ts,mjs}'];
const EVIDENCE_TEST = 'src/__tests__/directiveEvidence.test.ts';

export default defineConfig({
  define: {
    // Read by src/test/setup.ts to instantiate the regex engine.
    __PCRE2_WASM_PATH__: JSON.stringify(createRequire(import.meta.url).resolve('pcre2-wasm-utf16/pcre2.wasm')),
  },
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts', 'src/test/recordDirectiveEvidence.ts'],
    // Every test starts from a clean slate: a spy, a stubbed global or an env
    // var one test set never reaches the next.
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    testTimeout: 20000,
    // Two projects, run one after the other. `unit` is every test but one;
    // `evidence` is the one test that reads what the others recorded, so it has
    // to start after they have all finished. `groupOrder` is what guarantees
    // that: projects in the same group run together, groups run lowest first.
    // See src/test/recordDirectiveEvidence.ts.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: UNIT_TESTS,
          exclude: [...configDefaults.exclude, EVIDENCE_TEST],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'evidence',
          include: [EVIDENCE_TEST],
          sequence: { groupOrder: 1 },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Text for a local run, lcov for anything that ingests it, and
      // json-summary so the shared coverage-ratchet can read the numbers back
      // without re-running.
      reporter: ['text', 'lcov', 'json-summary'],
      // `include` covers every source file, not only the imported ones, so a
      // file with no test counts as 0% rather than being absent. An untested
      // file is exactly what a floor exists to notice.
      include: ['src/**/*.ts'],
      // Each exclusion carries its reason. Nothing is excluded to flatter the
      // numbers.
      exclude: [
        // The tests themselves, and the shared scaffolding they import.
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/test/**',
        // Type-only modules compile to nothing, so they report 0% forever.
        'src/types.ts',
        'src/scaffold/types.ts',
        // A generated data table: large, literal, and asserted through the
        // modules that read it rather than directly.
        'src/cim/cimModelsData.ts',
      ],
      // The floor lives here rather than in a CI flag, so `npm run
      // test:coverage` locally gives the same verdict CI does.
      //
      // Measured, not chosen: each floor is the suite's figure rounded down to
      // a whole percent, and CI's coverage-ratchet fails when a measurement
      // rises more than a point above its floor, printing the block to paste.
      // Raise a floor in the same change that raises coverage; never lower one
      // to make a branch green.
      //
      // Measured on 2026-11-13, with the tests that bring redosHeuristic.ts up
      // to the mutation floor (#8).
      thresholds: {
        statements: 98,
        branches: 94,
        functions: 99,
        lines: 99,
      },
    },
  },
});
