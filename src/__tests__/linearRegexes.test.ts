// ---------------------------------------------------------------------------
// linearRegexes.test.ts
// The patterns that CodeQL reported as polynomial (#20), each in a linear
// form. Each one gives the result of the pattern it replaced on generated
// input, and answers on the input that made that pattern quadratic. No
// stopwatch (propslab#507): as in derivePrefix.test.ts, the large inputs are
// sized so that a quadratic form cannot finish inside the test's timeout.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DIRECTIVE_RE } from '../parser/confParser';
import { parseExtractValue } from '../processors/fieldExtractor';
import { appendStanza } from '../scaffold/serialize';
import { normalizeSourcetype } from '../scaffold/analyzers/sourcetype';
import { detectLineFormat, xmlElementTags } from '../scaffold/analyzers/lineFormat';
import { unquoteFieldName } from '../utils/fieldRef';
import { fcSeed } from '../test/fcSeed';

fc.configureGlobal({ seed: fcSeed(2020), numRuns: 1000 });

const MILLION = 1_000_000;
const text = (...units: string[]) =>
  fc.array(fc.constantFrom(...units), { maxLength: 14 }).map((parts) => parts.join(''));
const detect = (raw: string) => detectLineFormat(raw, raw.split(/\r?\n/));

describe('DIRECTIVE_RE', () => {
  const lazyKey = /^([^\s=[][^=]*?)\s*=\s*(.*)$/;

  it('matches and captures what a lazy key did', () => {
    fc.assert(
      fc.property(text('a', 'b', ' ', '\t', '=', '[', '!'), (line) => {
        expect(DIRECTIVE_RE.exec(line)?.slice(1)).toEqual(lazyKey.exec(line)?.slice(1));
      }),
    );
  });

  it('answers on a long run of whitespace', () => {
    expect(DIRECTIVE_RE.exec(`!${'\t'.repeat(MILLION)}`)).toBeNull();
    expect(DIRECTIVE_RE.exec(`a${' b'.repeat(MILLION / 2)}`)).toBeNull();
    expect(DIRECTIVE_RE.exec(`a${'\t'.repeat(MILLION)}= v`)?.slice(1)).toEqual(['a', 'v']);
  });
});

describe('parseExtractValue', () => {
  const byRegex = (value: string) => {
    const trimmed = value.trim();
    const m = /^([\s\S]+)\s+in\s+('[^']*'|"[^"]*"|[\w.]+)\s*$/.exec(trimmed);
    return m ? { pattern: m[1], sourceField: unquoteFieldName(m[2] ?? '') } : { pattern: trimmed };
  };

  it('splits off the last " in <field>" as the greedy regex did', () => {
    fc.assert(
      fc.property(text('a', 'in', 'x.y', ' ', '\t', "'", '"', '(', '\\s'), (value) => {
        expect(parseExtractValue(value)).toEqual(byRegex(value));
      }),
    );
  });

  it('answers on a long run of whitespace', () => {
    const tabs = `a${'\t'.repeat(MILLION)}b`;
    expect(parseExtractValue(tabs)).toEqual({ pattern: tabs });
    expect(parseExtractValue(`x${' '.repeat(MILLION)}in src`)).toEqual({
      pattern: `x${' '.repeat(MILLION - 1)}`,
      sourceField: 'src',
    });
  });
});

describe('appendStanza', () => {
  it('drops the trailing whitespace that a \\s+$ replace dropped', () => {
    fc.assert(
      fc.property(text('a', ' ', '\t', '\n', '\u00a0', '\u2028'), (existing) => {
        const trimmed = existing.replace(/\s+$/, '');
        expect(appendStanza(existing, '[s]')).toBe(trimmed ? `${trimmed}\n\n[s]\n` : '[s]\n');
      }),
    );
  });

  it('answers on a long run of whitespace before the end', () => {
    const existing = `a${'\t'.repeat(MILLION)}b`;
    expect(appendStanza(existing, '[s]')).toBe(`${existing}\n\n[s]\n`);
  });
});

describe('normalizeSourcetype', () => {
  const byRuns = (current: string) => {
    const trimmed = current.trim();
    if (!trimmed || /^[a-z0-9]+([:_-][a-z0-9]+)*$/.test(trimmed)) return null;
    const normalized = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ':')
      .replace(/^:+|:+$/g, '');
    return normalized && normalized !== trimmed ? normalized : null;
  };

  it('trims the ends as stripping runs of ":" did', () => {
    fc.assert(
      fc.property(text('a', 'B', '1', ':', '_', '-', ' ', '.'), (current) => {
        expect(normalizeSourcetype(current)).toBe(byRuns(current));
      }),
    );
  });
});

describe('xmlElementTags', () => {
  // The tag pattern that the scanner replaced, with an attribute value that
  // stops at `<`, which XML does not allow there.
  const tagRe =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][^>]*>|<(\/?)([A-Za-z_][\w.:-]*)(?:"[^"<]*"|'[^'<]*'|[^'"<>])*?(\/?)>/g;
  const byRegex = (raw: string) =>
    [...raw.matchAll(tagRe)].flatMap((m) =>
      m[2] === undefined ? [] : [{ name: m[2], closing: Boolean(m[1]), selfClosing: Boolean(m[3]) }],
    );

  it('finds the element tags that the tag pattern found', () => {
    fc.assert(
      fc.property(
        text('<', '>', '/', '<!--', '-->', '<![CDATA[', ']]>', '<?', '<!', '"', "'", 'a', 'b:c', ' ', '\n', '='),
        (raw) => {
          expect(xmlElementTags(raw)).toEqual(byRegex(raw));
        },
      ),
    );
  });

  it('answers on many unterminated constructs', () => {
    expect(xmlElementTags('<!--'.repeat(MILLION / 4))).toEqual([]);
    expect(xmlElementTags('<?'.repeat(MILLION / 2))).toEqual([]);
    expect(xmlElementTags('<![CDATA['.repeat(100_000))).toEqual([]);
    expect(xmlElementTags('<a "'.repeat(MILLION / 4))).toEqual([]);
    expect(xmlElementTags('<a>'.repeat(300_000))).toHaveLength(300_000);
  });
});

describe('detectLineFormat', () => {
  it('answers on many blank lines after an XML root', () => {
    const kvMode = detect(`<a/>${'\n'.repeat(MILLION)}`).find((s) => s.key === 'KV_MODE');
    expect(kvMode?.value).toBe('xml');
  });

  it('answers on "}" and many line breaks with no "{"', () => {
    expect(detect(`}}${'\n'.repeat(MILLION)}`)).toBeDefined();
  });

  it('still tells several multi-line JSON objects from one', () => {
    const several = detect('{\n "a": 1\n}\n \t\n{\n "b": 2\n}').find((s) => s.key === 'LINE_BREAKER');
    const one = detect('{\n "a": 1,\n "b": { "c": 2 }\n}').find((s) => s.key === 'LINE_BREAKER');
    expect(several?.evidence).not.toBe(one?.evidence);
  });
});
