import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import importX from 'eslint-plugin-import-x';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import comments from './scripts/eslint-comments.mjs';
import lintAllowlist from './scripts/lint-allowlist.json' with { type: 'json' };

/**
 * Lint catches mistakes; Prettier owns layout. Nothing here enforces where a
 * brace goes. Every rule that departs from the preset is beside its reason, and
 * when a rule is wrong for this codebase it is turned off here with the
 * sentence saying why, never with an `eslint-disable` at the call site.
 *
 * Type-aware (`projectService`), so the typed rules resolve each file through
 * tsconfig.json. Not for type correctness, which `tsc` owns, but for what
 * compiles and is still wrong: a promise nobody awaits, an `any` spreading, a
 * `!` nobody checked.
 */
export default defineConfig([
  // All generated: build output, the reports the test suites write, and
  // Stryker's sandbox while a run is in progress.
  globalIgnores(['dist', 'coverage', 'reports', '.stryker-tmp', '.claude']),
  {
    files: ['**/*.{ts,mts}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // An intentionally unused identifier is prefixed `_`, the TypeScript
      // convention for implementing an interface you only partly need.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // A union gains a member and every switch over it has to name it: a
      // `default:` does not count as handling a union member, since it is
      // where the new one would silently land.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // Shipped code narrows or guards instead of asserting: a `!` is a claim
      // the compiler cannot check. The test override below turns it off, where
      // `arr[0]!` after a length assertion is how a case reads its subject.
      '@typescript-eslint/no-non-null-assertion': 'error',
      // `onClick={() => set(false)}` returns the setter's void; the rule's own
      // option exempts that shorthand and still reports a void value used
      // anywhere it could be mistaken for a result.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Counts and offsets go into messages everywhere. Numbers stringify
      // predictably; objects, nullish values and the rest stay reported.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Test code and its support files. With noUncheckedIndexedAccess on,
    // `result[0]!` after `expect(result).toHaveLength(1)` is how a case reads
    // the thing it just asserted exists; the rule would ask for a runtime guard
    // restating the expect() beside it.
    files: ['**/*.test.{ts,mts}', 'src/test/**/*.{ts,mts}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // What makes a test a test. `expect-expect` fails a case that asserts
    // nothing (it passes whatever the code does), `no-identical-title` a case
    // whose name repeats a sibling's (one of the two is then unfindable in a
    // report, and often a copy that was never edited), and `valid-expect` an
    // `expect(...)` that is never finished or an async one that is not awaited.
    files: ['**/*.test.{ts,mts}'],
    plugins: { vitest },
    rules: {
      // A helper that asserts on the test's behalf is named `expect…`, which
      // the pattern covers, so a new one takes that name rather than an entry.
      // `fc.assert` is the one other assertion: it throws with the shrunk
      // counterexample when a property is false.
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expect*', 'fc.assert'] }],
      'vitest/no-identical-title': 'error',
      // Vitest's expect takes a failure message as its second argument.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
    },
  },
  {
    // A test asserts a diagnostic's code and data, never its message, so a
    // change of wording breaks no behaviour test (#56, docs/code-style.md). A
    // thrown error is asserted with `toThrow()`, which this does not match.
    // scripts/eslint-config.test.mjs lints real lines against these selectors.
    files: ['**/*.test.{ts,mts}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='expect'] > MemberExpression.arguments[property.name='message']",
          message: 'Assert the code and the data of a diagnostic, not its message (docs/code-style.md).',
        },
        {
          selector:
            "CallExpression[callee.property.name='objectContaining'] > ObjectExpression > Property[key.name='message']",
          message: 'Assert the code and the data of a diagnostic, not its message (docs/code-style.md).',
        },
        // A test says which clock it runs under (propslab#507): runPipeline
        // falls back to Date.now(), and a date that is fine today trips
        // MAX_DAYS_AGO in a few years. Its options, the fifth argument, carry
        // `now`: a literal must name it, or pass something that does
        // (FIXED_NOW, AT_FIXED_NOW, runCtx()). propslab#572.
        {
          selector: "CallExpression[callee.name='runPipeline'][arguments.length<5]:not(:has(> SpreadElement))",
          message: 'Pass runPipeline its options with `now` (FIXED_NOW from src/__tests__/runCtx.ts).',
        },
        {
          selector:
            "CallExpression[callee.name='runPipeline'] > ObjectExpression:nth-child(5):not(:has(> Property[key.name='now'])):not(:has(> SpreadElement))",
          message: 'runPipeline options need `now` (FIXED_NOW from src/__tests__/runCtx.ts).',
        },
      ],
      // This engine extracts fields whose names collide with Object.prototype
      // members on purpose (prototypeFieldNames.test.ts). Reading
      // `fields['toString']` resolves to the index signature, but the rule
      // matches on the property name and reports each such assertion as an
      // unbound method. The rule stays on for shipped code.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // A consumer runs this engine inside a process whose stdout is a protocol
    // channel: the MCP server's JSON-RPC stream. A stray console.log corrupts
    // it. Diagnostics go to stderr, which console.error and console.warn write.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },
  {
    // A false positive: the rule reads the U+0300–U+036F combining-mark range
    // in NAME_CHAR as a combined character, and it is a range endpoint
    // (propslab#774).
    files: ['src/utils/xmlReader.ts'],
    rules: { 'no-misleading-character-class': 'off' },
  },
  {
    // The test runs each documented example, which is code in a string.
    files: ['src/__tests__/docsEngineExamples.test.ts'],
    rules: { '@typescript-eslint/no-implied-eval': 'off' },
  },
  {
    // State that changes at module level is a hidden input to every function
    // that reads it: two callers in one process share it, and a test cannot
    // give a function another value without changing the module. It belongs to
    // the object that owns the operation, passed in that operation's context
    // (#55, docs/code-style.md). A module-level `const` holding a Map or a Set
    // is not matched; a cache of that shape is left to review.
    //
    // Tests are exempt: a `let` that `beforeEach` sets is how a suite shares a
    // fixture. They are left out with `ignores` rather than overridden, because
    // a later block's `no-restricted-syntax` replaces an earlier block's list
    // for the same file instead of adding to it. A new list for these files is
    // merged into this one. scripts/eslint-config.test.mjs lints real lines
    // through both blocks.
    files: ['**/*.{ts,mts}', 'scripts/**/*.{js,mjs}'],
    ignores: ['**/*.test.{ts,mts,mjs}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: ':matches(Program, ExportNamedDeclaration) > VariableDeclaration[kind="let"]',
          message: 'Do not keep state that changes at module level. Pass it in the context of the operation.',
        },
      ],
    },
  },
  {
    // The FC_SEED notice prints one time in each test process: one flag per
    // process, by design, so the rule above does not fit it. Any other `let`
    // in the file is still reported.
    files: ['src/test/fcSeed.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ':matches(Program, ExportNamedDeclaration) > VariableDeclaration[kind="let"]:not(:has(> VariableDeclarator[id.name="seedLogged"]))',
          message: 'Do not keep state that changes at module level. Pass it in the context of the operation.',
        },
      ],
    },
  },
  {
    // Maintenance scripts and this config: plain JavaScript outside every
    // tsconfig, so no type-aware rules. ESM, because package.json is
    // "type": "module".
    files: ['scripts/**/*.{js,mjs}', 'eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    // Import order: Node built-ins, then packages, then the project's own files,
    // and no finer. Within a group the order is the author's, and blank lines
    // are Prettier's. Side-effect imports are not ordered, which matters where
    // one has to run first. The fixer moves whole declarations, so
    // `eslint --fix` applies it.
    files: ['**/*.{ts,mts,js,mjs}'],
    plugins: { 'import-x': importX },
    rules: {
      'import-x/order': [
        'error',
        { groups: ['builtin', 'external', ['parent', 'sibling', 'index']], 'newlines-between': 'ignore' },
      ],
    },
  },
  {
    // The comment rules in CONTRIBUTING ("Code comments") that a tool can
    // check: a TODO names its issue, and code is not kept in a comment.
    files: ['**/*.{ts,mts,js,mjs}'],
    plugins: { comments },
    rules: { 'comments/todo-has-issue': 'error', 'comments/no-commented-out-code': 'error' },
  },
  {
    // Size and branching limits for hand-written code, so a function stays a
    // sequence of named steps rather than growing into a 400-line body. Lines
    // are counted without blanks and comments: the rationale kept beside a
    // rule is not what makes a function hard to follow.
    files: ['**/*.{ts,mts}', 'scripts/**/*.{js,mjs}'],
    rules: {
      'max-lines-per-function': ['error', { max: 100, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 25],
      // Past four positional parameters a call is a row of bare values matched
      // by position, and a caller passes a default only to reach a later one,
      // so a function that needs more takes one options object (#54). Four,
      // not three: three reports callbacks whose list a library defines, where
      // the author does not choose it.
      'max-params': ['error', 4],
    },
  },
  {
    // Tests are exempt from length and branching: a describe() callback holds a
    // whole suite, so its length counts cases, and a table of cases is not
    // branching logic. `max-params` stays on, because a test helper with many
    // positional arguments is as hard to read as shipped code.
    files: ['**/*.test.{ts,mts,mjs}'],
    rules: {
      'max-lines-per-function': 'off',
      complexity: 'off',
    },
  },
  // The findings that existed when a rule was adopted, off for their files
  // only (docs/code-style.md). Last, so that it wins over the blocks that turn
  // the rules on. CI's lint-allowlist-check lints the same files with the
  // rules on again and fails when a count changes, so this hides no new code.
  // Each path is escaped, because `files` takes a glob and `[id]` is a
  // character class.
  ...Object.entries(lintAllowlist.files).map(([file, rules]) => ({
    files: [file.replace(/[\\[\]{}()*?!+@]/g, '\\$&')],
    rules: Object.fromEntries(Object.keys(rules).map((rule) => [rule, 'off'])),
  })),
]);
