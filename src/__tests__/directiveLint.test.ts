// ---------------------------------------------------------------------------
// directiveLint.test.ts
// The two rules that catch mistakes Splunk itself is silent about.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { runPipeline } from '../pipeline';
import type { EventMetadata } from '../types';
import { FIXED_NOW } from './runCtx';

const metadata: EventMetadata = { index: 'main', host: 'h', source: 's', sourcetype: 'st' };

function diagnosticsFor(props: string, transforms = '') {
  return runPipeline('2026-01-15T10:00:00Z hello world\n', metadata, `[st]\n${props}`, transforms, {
    perEventPipeline: false,
    captureOffsets: false,
    now: FIXED_NOW,
  }).diagnostics;
}

const codesFor = (props: string, transforms = '') => diagnosticsFor(props, transforms).map((d) => d.code);

describe('propslab#177 — a transforms setting that is inert in its phase', () => {
  it('flags a search-time-only setting in a TRANSFORMS- stanza', () => {
    const d = diagnosticsFor('TRANSFORMS-x = t1\n', '[t1]\nREGEX = (\\w+)\nFORMAT = a::$1\nMV_ADD = true\n').find(
      (x) => x.directiveKey === 'MV_ADD',
    );
    expect(d?.level).toBe('warning');
    expect(d?.code).toBe('setting-inert-in-phase');
    expect(d?.message).toContain('TRANSFORMS-');
    expect(d?.file).toBe('transforms.conf');
  });

  it('flags an index-time-only setting in a REPORT- stanza', () => {
    const d = diagnosticsFor('REPORT-x = t1\n', '[t1]\nREGEX = (?<a>\\w+)\nREPEAT_MATCH = true\n').find(
      (x) => x.directiveKey === 'REPEAT_MATCH',
    );
    expect(d?.code).toBe('setting-inert-in-phase');
    expect(d?.message).toContain('REPORT-');
  });

  it('says nothing when the setting is live for that phase', () => {
    const codes = codesFor('REPORT-x = t1\n', '[t1]\nREGEX = (\\w+)\nFORMAT = a::$1\nMV_ADD = true\n');
    expect(codes).not.toContain('setting-inert-in-phase');
  });

  it('stays quiet for a stanza reached from both, where every setting is live somewhere', () => {
    const inert = diagnosticsFor(
      'TRANSFORMS-a = t1\nREPORT-b = t1\n',
      '[t1]\nREGEX = (\\w+)\nFORMAT = a::$1\nMV_ADD = true\nREPEAT_MATCH = true\n',
    ).filter((d) => d.code === 'setting-inert-in-phase');
    // The lint names each directive. The index-time pass still reports the
    // stanza for its TRANSFORMS- use, with no directive.
    expect(inert.map((d) => d.directiveKey)).toEqual([undefined]);
  });

  it('stays quiet for a stanza props.conf never references', () => {
    const codes = codesFor('', '[orphan]\nREGEX = (\\w+)\nMV_ADD = true\n');
    expect(codes).not.toContain('setting-inert-in-phase');
  });

  it('flags REPEAT_MATCH alongside DEST_KEY = _raw, which the spec calls out separately', () => {
    const d = diagnosticsFor(
      'TRANSFORMS-x = t1\n',
      '[t1]\nREGEX = (\\w+)\nDEST_KEY = _raw\nFORMAT = x\nREPEAT_MATCH = true\n',
    ).find((x) => x.code === 'repeat-match-ignored');
    expect(d?.directiveKey).toBe('REPEAT_MATCH');
  });
});

describe('propslab#179 — a value that is not the documented type', () => {
  it('flags a boolean that is not a boolean literal', () => {
    const d = diagnosticsFor('SHOULD_LINEMERGE = yes please\n').find((x) => x.directiveKey === 'SHOULD_LINEMERGE');
    expect(d?.level).toBe('warning');
    expect(d?.code).toBe('value-not-boolean');
  });

  it('accepts every boolean spelling Splunk does', () => {
    // y/n/on/off: the engine and the linter share one boolean reader, so the
    // linter accepts every spelling the engine honours.
    for (const v of ['true', 'False', '1', '0', 't', 'f', 'yes', 'no', 'y', 'n', 'on', 'off']) {
      expect(codesFor(`SHOULD_LINEMERGE = ${v}\n`), `for ${v}`).not.toContain('value-not-boolean');
    }
  });

  it('flags a non-numeric integer', () => {
    const d = diagnosticsFor('TRUNCATE = lots\n').find((x) => x.directiveKey === 'TRUNCATE');
    expect(d?.code).toBe('value-not-integer');
  });

  it('flags a negative where the spec says non-negative', () => {
    const d = diagnosticsFor('TRUNCATE = -1\n').find((x) => x.directiveKey === 'TRUNCATE');
    expect(d?.code).toBe('value-negative');
  });

  // Doc-derived: props.conf.spec documents -1 as disabling the lookahead
  // limit, so it is a setting rather than a mistake. Other negatives still are.
  it('accepts MAX_TIMESTAMP_LOOKAHEAD = -1, which the spec documents as "no limit"', () => {
    const lint = (v: string) =>
      diagnosticsFor(`MAX_TIMESTAMP_LOOKAHEAD = ${v}\n`).filter(
        (x) => x.directiveKey === 'MAX_TIMESTAMP_LOOKAHEAD' && x.code === 'value-negative',
      );
    expect(lint('-1')).toEqual([]);
    expect(lint('-2')).toHaveLength(1);
  });

  it('flags a value outside a documented enum, and lists the valid ones', () => {
    const d = diagnosticsFor('KV_MODE = XLM\n').find((x) => x.directiveKey === 'KV_MODE');
    expect(d?.code).toBe('value-not-in-enum');
    expect(d?.message).toContain('auto_escaped');
  });

  it('accepts the one enum member that carries an argument', () => {
    expect(codesFor('KV_MODE = multi:mystanza\n')).not.toContain('value-not-in-enum');
  });

  it('treats an empty value as a reset rather than a type error', () => {
    expect(codesFor('TRUNCATE =\n')).not.toContain('value-not-integer');
  });

  it('says nothing about a correct config', () => {
    const codes = codesFor('SHOULD_LINEMERGE = false\nTRUNCATE = 10000\nKV_MODE = auto\n');
    expect(codes.filter((c) => c.startsWith('value-'))).toEqual([]);
  });

  it('checks transforms.conf too', () => {
    const d = diagnosticsFor('REPORT-x = t1\n', '[t1]\nREGEX = (\\w+)\nFORMAT = a::$1\nMV_ADD = maybe\n').find(
      (x) => x.directiveKey === 'MV_ADD' && x.code === 'value-not-boolean',
    );
    expect(d).toBeDefined();
  });
});
