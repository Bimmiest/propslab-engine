// ---------------------------------------------------------------------------
// diagnosticCodes.test.ts
// DIAGNOSTIC_CODES, the list that DiagnosticCode is derived from (#22): each
// code once, and each one in a table of docs/api.md, so that a new code
// cannot ship without its meaning.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { DIAGNOSTIC_CODES } from '../index';

describe('DIAGNOSTIC_CODES', () => {
  it('holds each code once', () => {
    expect(new Set(DIAGNOSTIC_CODES).size).toBe(DIAGNOSTIC_CODES.length);
  });

  it('has a row in docs/api.md for each code', () => {
    const api = readFileSync(new URL('../../docs/api.md', import.meta.url), 'utf8');
    expect(DIAGNOSTIC_CODES.filter((code) => !api.includes(`| \`${code}\` |`))).toEqual([]);
  });
});
