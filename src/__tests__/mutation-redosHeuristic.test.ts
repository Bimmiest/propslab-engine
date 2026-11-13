// Tests written against mutants that survived `npm run test:mutation` (#8).
// Each pins a verdict of the ReDoS heuristic that the suite ran but never
// asserted: how the scanner reads escapes, classes, groups and quantifiers,
// how it splits alternatives, what bounds a repetition, the depth and length
// caps, and the verdict memo. The patterns are hand-written.
import { describe, it, expect, vi } from 'vitest';
import { hasReDoSRisk } from '../utils/redosHeuristic';

/**
 * How many regex tests one call runs on the whole of `pattern`: none when the
 * memo answers. Each computed verdict tests the pattern against the
 * adjacent-quantifier regex at least, and the presence check adds a second test.
 */
function wholePatternTests(pattern: string): number {
  const test = vi.spyOn(RegExp.prototype, 'test');
  try {
    hasReDoSRisk(pattern);
    return test.mock.calls.filter(([input]) => input === pattern).length;
  } finally {
    test.mockRestore();
  }
}

const padded = (core: string, length: number) => core + 'x'.repeat(length - core.length);

describe('hasReDoSRisk — a pattern the scanner cannot read is assumed risky', () => {
  it.each([
    ['[abc', 'a character class that does not close'],
    ['(a[b)', 'a group that holds a class that does not close'],
    ['xx(a[b)', 'the same group after other atoms'],
    ['(ab', 'a group that does not close'],
    ['a)b', 'a ")" that closes nothing'],
    ['a\\', 'a backslash at the end'],
    ['(a)\\1', 'a backreference, whose language is unknown'],
    ['x\\9', 'the highest one-digit backreference'],
    ['(a)(?:b\\1)+', 'a backreference in the body of a repeated group'],
  ])('flags %s: %s', (pattern) => {
    expect(hasReDoSRisk(pattern)).toBe(true);
  });
});

describe('hasReDoSRisk — what the scanner reads as one atom', () => {
  it.each([
    ['(\\(a+)+', 'an escaped "(" does not open a group'],
    ['(?:[)]a)+', 'a ")" in a class does not close the group'],
    ['(?:(?:ab)c)+', 'a nested group closes before its parent'],
    ['(?:\\d+\\|)+', 'an escaped "|" does not split the body'],
    ['(?:\\d+[|])+', 'a "|" in a class does not split the body'],
    ['a{x}', 'a "{" that starts no bound is a literal'],
    ['(?:a+?b)+', 'a lazy suffix is part of the quantifier'],
    ['(?:a++b)+', 'a possessive suffix is part of the quantifier'],
    ['(?:\\d+x{y}{0,})+', 'a bound must start at its "{"'],
    ['[a+]+', 'a class is one atom, with no body to analyse'],
    ['(?i)abc', 'an inline flag group has no body'],
    ['(x(?:y)z+)+', 'a capture group with a nested "(?:" keeps its whole body'],
  ])('does not flag %s: %s', (pattern) => {
    expect(hasReDoSRisk(pattern)).toBe(false);
  });

  it.each([
    ['(?:\\w+\\b)+', 'a word boundary consumes nothing, so it cannot bound the run'],
    ['(?:\\w+\\B)+', 'a non-boundary consumes nothing either'],
    ['(?:^a+)+', 'a start anchor cannot bound the run'],
    ['(?:a+$)+', 'an end anchor cannot bound the run'],
    ['(?:\\w+(?=\\w))+', 'a group that only holds a lookahead is not itself zero-width'],
  ])('flags %s: %s', (pattern) => {
    expect(hasReDoSRisk(pattern)).toBe(true);
  });
});

describe('hasReDoSRisk — top-level alternatives of a group body', () => {
  it.each([
    ['(?:a+|b)+', 'the first alternative repeats with nothing after it'],
    ['(?:b|a+)+', 'the last alternative repeats with nothing before it'],
    ['(?:[a]|b+)+', 'a class before the "|" does not stop the split'],
    ['(?:b(?:x)|a+)+', 'a group before the "|" does not stop the split'],
  ])('flags %s: %s', (pattern) => {
    expect(hasReDoSRisk(pattern)).toBe(true);
  });
});

describe('hasReDoSRisk — the quantifier of a group', () => {
  it.each([
    ['(a+){1,10}', 'a bound with a two-digit maximum'],
    ['(a+){1,}', 'a bound with no maximum'],
  ])('flags %s: %s repeats the body', (pattern) => {
    expect(hasReDoSRisk(pattern)).toBe(true);
  });

  it.each([
    ['(a+){1}', 'exactly once'],
    ['(a+){0,1}', 'at most once'],
  ])('does not flag %s: %s is no repetition', (pattern) => {
    expect(hasReDoSRisk(pattern)).toBe(false);
  });
});

describe('hasReDoSRisk — the prefix of a group', () => {
  it.each([
    ['(?im:(a+)+)', 'two scoped flags'],
    ['(?i-sm:(a+)+)', 'two flags turned off'],
    ['(?<name>a+)+', 'a named group'],
    ["(?'name'a+)+", 'a named group in quotes'],
    ['(?P<name>a+)+', 'a Python-style named group'],
  ])('reads the body after %s: %s', (pattern) => {
    expect(hasReDoSRisk(pattern)).toBe(true);
  });
});

describe('hasReDoSRisk — what bounds a repetition in a body', () => {
  it.each([
    ['(?:a+b?)+', 'an optional atom does not bound the run'],
    ['(a+b?)+', 'nor in a capture group'],
    ['(?:\\d+x{0,10})+', 'a bound from zero is optional'],
    ['(?:a+b{0,3})+', 'a bound from zero with a maximum is optional'],
    ['(?:a{10,})+', 'a bound with a two-digit minimum and no maximum is unbounded'],
    ['(?:.+\\n)+', 'a dot can match a newline'],
    ['(?:\\n+.)+', 'a newline can match a dot'],
    ['(?:a+[z-a])+', 'an atom the overlap test cannot compile counts as an overlap'],
    ['(?:x\\d+(?:y))+', 'a group after the run is opaque'],
    ['(?:x\\d+5)+', 'the next atom overlaps the run'],
    ['(?:(?:ab)+c)+', 'a repeated group in a repeated group'],
  ])('flags %s: %s', (pattern) => {
    expect(hasReDoSRisk(pattern)).toBe(true);
  });

  it.each([
    ['(?:\\d+x?y)+', 'a mandatory atom after an optional one bounds the run'],
    ['(?:\\d+(?=,),)+', 'a lookahead between the run and its bound is skipped'],
  ])('does not flag %s: %s', (pattern) => {
    expect(hasReDoSRisk(pattern)).toBe(false);
  });
});

describe('hasReDoSRisk — the depth cap', () => {
  it('analyses 20 nested groups', () => {
    const nested = '('.repeat(20) + 'x' + ')'.repeat(20);
    expect(hasReDoSRisk(nested)).toBe(false);
  });

  it('assumes 21 nested groups are risky', () => {
    const nested = '('.repeat(21) + 'x' + ')'.repeat(21);
    expect(hasReDoSRisk(nested)).toBe(true);
  });
});

describe('hasReDoSRisk — the length caps', () => {
  it('runs the full analysis at exactly 2,000 characters', () => {
    // The full analysis knows that `\d+` cannot match the `.` of IPv4.
    expect(hasReDoSRisk(padded('(\\d+\\.){3}\\d+', 2000))).toBe(false);
  });

  it('runs only the presence check above 2,000 characters', () => {
    // The presence check flags each quantified group that holds a quantifier.
    expect(hasReDoSRisk(padded('(\\d+\\.){3}\\d+', 2001))).toBe(true);
  });
});

describe('hasReDoSRisk — the verdict memo', () => {
  it('answers a pattern that it saw before from the memo', () => {
    expect(wholePatternTests('memo-hit+')).toBe(1);
    expect(wholePatternTests('memo-hit+')).toBe(0);
  });

  it('keeps a pattern of exactly 2,000 characters', () => {
    const pattern = padded('memo-2000', 2000);
    expect(wholePatternTests(pattern)).toBe(1);
    expect(wholePatternTests(pattern)).toBe(0);
  });

  it('does not keep a pattern above 2,000 characters', () => {
    const pattern = padded('memo-2001', 2001);
    expect(wholePatternTests(pattern)).toBe(2);
    expect(wholePatternTests(pattern)).toBe(2);
  });

  it('keeps the 500 newest patterns, and drops the oldest first', () => {
    // 500 new patterns fill the memo, whatever it held before.
    for (let i = 0; i < 500; i++) hasReDoSRisk(`fifo-${i}`);
    expect(wholePatternTests('fifo-1')).toBe(0);
    hasReDoSRisk('fifo-500');
    expect(wholePatternTests('fifo-0')).toBe(1);
    expect(wholePatternTests('fifo-2')).toBe(0);
  });
});
