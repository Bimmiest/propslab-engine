import type { SplunkEvent, ConfDirective, DirectiveNoOp } from '../types';
import { extractionLimits, safeRegex, validateRegex, type SplunkRegex } from '../utils/splunkRegex';
import { explainNoMatch, noOpDirectiveKey, type NoOpReason } from '../noOpExplainer';
import { effectiveValue } from '../utils/directiveValues';
import { isInternalField } from '../utils/internalFields';
import { byClassName } from '../utils/asciiCompare';
import { unquoteFieldName } from '../utils/fieldRef';
import { getMetadataField } from '../utils/metadataFields';
import { getField, hasField, setField } from '../utils/fieldBag';
import { atDirective } from '../parser/provenance';
import type { RunContext, DiagnosticSink, ExplanationBudget } from '../runContext';

/**
 * Each EXTRACT runs under its stanza's MATCH_LIMIT and DEPTH_LIMIT (Splunk's
 * defaults when unset). A match that hits one is no match, as in Splunk, and
 * the no-op says which limit it was.
 *
 * @param captureOffsets Record the capture spans of positional extractions in
 *   `fieldOffsets`, which the highlighter reads. Defaults to `true`; a caller
 *   that renders no highlights can pass `false` to skip the bookkeeping.
 */
export function extractFields(events: SplunkEvent[], directives: ConfDirective[], ctx: RunContext): SplunkEvent[] {
  const { diagnostics, captureOffsets } = ctx;
  const extractDirectives = directives.filter((d) => d.directiveType === 'EXTRACT').sort(byClassName);

  if (extractDirectives.length === 0) return events;

  const limits = extractionLimits(effectiveValue(directives, 'MATCH_LIMIT'), effectiveValue(directives, 'DEPTH_LIMIT'));

  const extractions = extractDirectives.map((dir): Extraction => {
    const { pattern, sourceField } = parseExtractValue(dir.value);
    // Inline EXTRACT extracts the FIRST match only (max_match defaults to 1);
    // multivalue extraction requires a transforms.conf REGEX with MV_ADD, which
    // EXTRACT lacks.
    const regex = pattern ? safeRegex(pattern, '', limits) : null;
    // An extraction that does not compile is skipped, so surface it.
    if (pattern && !regex) {
      diagnostics.push({
        code: 'regex-invalid',
        level: 'warning',
        message: `EXTRACT-${dir.className ?? ''} was skipped: its pattern does not compile (${validateRegex(pattern) ?? 'invalid regex'}). No fields were extracted.`,
        file: 'props.conf',
        ...atDirective(dir),
        directiveKey: dir.key,
      });
    }
    return { directive: dir, regex, sourceField };
  });

  const reportedStrippedRefs = new Set<string>();
  return events.map((event) => {
    const state: ExtractionState = {
      fields: { ...event.fields },
      offsets: { ...(event.fieldOffsets ?? {}) },
      offsetsChanged: false,
      traces: [],
      noOps: [],
    };
    for (const extraction of extractions) {
      runExtraction(event, extraction, state, {
        diagnostics,
        captureOffsets,
        reportedStrippedRefs,
        explanations: ctx.explanations,
      });
    }
    return {
      ...event,
      fields: state.fields,
      ...(state.offsetsChanged ? { fieldOffsets: state.offsets } : {}),
      processingTrace: [...event.processingTrace, ...state.traces],
      ...(state.noOps.length > 0 ? { noOps: [...(event.noOps ?? []), ...state.noOps] } : {}),
    };
  });
}

interface Extraction {
  directive: ConfDirective;
  regex: SplunkRegex | null;
  sourceField: string | undefined;
}

/** What one event accumulates as its EXTRACTs run. */
interface ExtractionState {
  fields: SplunkEvent['fields'];
  offsets: Record<string, Array<[number, number]>>;
  offsetsChanged: boolean;
  traces: SplunkEvent['processingTrace'];
  /**
   * Every directive that stops early in runExtraction changed nothing, and
   * says why here.
   */
  noOps: DirectiveNoOp[];
}

interface ExtractionOptions {
  diagnostics: DiagnosticSink | undefined;
  captureOffsets: boolean;
  /** Source fields already warned about, so each is reported once per run. */
  reportedStrippedRefs: Set<string>;
  explanations: ExplanationBudget;
}

function noteNoOp(state: ExtractionState, dir: ConfDirective, reason: NoOpReason): void {
  state.noOps.push({
    directive: dir.key,
    file: 'props.conf',
    line: dir.line,
    phase: 'search-time',
    reason,
  });
}

/**
 * Warn when an EXTRACT reads `in _field` and the event has `field`: index-time
 * extractions strip leading underscores, so Splunk resolves the name without it.
 */
function warnStrippedSourceRef(
  fields: SplunkEvent['fields'],
  extraction: Extraction,
  options: ExtractionOptions,
): void {
  const { diagnostics, reportedStrippedRefs } = options;
  const { sourceField, directive } = extraction;
  if (
    !diagnostics ||
    !sourceField ||
    !sourceField.startsWith('_') ||
    isInternalField(sourceField) ||
    reportedStrippedRefs.has(sourceField)
  ) {
    return;
  }
  const stripped = sourceField.replace(/^_+/, '');
  if (!stripped || !hasField(fields, stripped)) return;
  reportedStrippedRefs.add(sourceField);
  diagnostics.push({
    code: 'leading-underscore-stripped',
    level: 'warning',
    message: `EXTRACT-${directive.className ?? ''} references source field "${sourceField}", but index-time extractions strip leading underscores — Splunk will resolve this as "${stripped}".`,
    file: 'props.conf',
    ...atDirective(directive),
    directiveKey: directive.key,
    suggestion: `Replace "in ${sourceField}" with "in ${stripped}"`,
  });
}

/**
 * Splunk trims leading and trailing whitespace from an EXTRACT value, and an
 * empty result creates no field, as observed in Splunk (propslab#411). Spaces and tabs
 * were observed; the rest of ASCII whitespace is trimmed with them. Whether non-ASCII spaces such as
 * U+00A0 are trimmed is unchecked, so they are kept.
 */
const LEADING_WHITESPACE = /^[ \t\n\v\f\r]+/;
const TRAILING_WHITESPACE = /[ \t\n\v\f\r]+$/;

/** Store a match's named groups, first-wins, and trace or explain the outcome. */
function storeGroups(
  directive: ConfDirective,
  groups: Record<string, string | undefined>,
  indices: Record<string, [number, number] | undefined> | undefined,
  state: ExtractionState,
): void {
  const added: string[] = [];
  const alreadySet: string[] = [];
  const emptied: string[] = [];
  for (const [name, captured] of Object.entries(groups)) {
    if (captured === undefined) continue;
    const lead = LEADING_WHITESPACE.exec(captured)?.[0].length ?? 0;
    const value = captured.slice(lead).replace(TRAILING_WHITESPACE, '');
    if (value === '') {
      emptied.push(name);
      continue;
    }
    // First-wins (a simplification): this engine keeps the value from
    // the first extraction and discards later ones for the same field name.
    // Real Splunk's behaviour when two search-time extractions yield the same
    // field is closer to producing a multivalue field; verify against a live
    // indexer before relying on the collision outcome here.
    if (hasField(state.fields, name)) {
      alreadySet.push(name);
      continue;
    }
    setField(state.fields, name, value);
    added.push(name);
    const span = indices?.[name];
    if (span) {
      // The highlight covers the value as stored, without what was trimmed.
      const start = span[0] + lead;
      setField(state.offsets, name, [[start, start + value.length]]);
      state.offsetsChanged = true;
    }
  }

  if (added.length > 0) {
    state.traces.push({
      processor: `EXTRACT-${directive.className ?? ''}`,
      phase: 'search-time',
      description: `Extracted fields: ${added.join(', ')}`,
      fieldsAdded: added,
    });
  } else if (alreadySet.length > 0) {
    // It matched and still produced nothing, which looks identical in the
    // preview to a pattern that never matched at all.
    noteNoOp(state, directive, { kind: 'fields-already-set', fields: alreadySet });
  } else if (emptied.length > 0) {
    noteNoOp(state, directive, { kind: 'values-empty', fields: emptied });
  } else {
    noteNoOp(state, directive, { kind: 'groups-unset', fields: Object.keys(groups) });
  }
}

/** Run one EXTRACT against one event. */
function runExtraction(
  event: SplunkEvent,
  extraction: Extraction,
  state: ExtractionState,
  options: ExtractionOptions,
): void {
  const { directive, regex, sourceField } = extraction;
  if (!regex) {
    const { pattern } = parseExtractValue(directive.value);
    noteNoOp(state, directive, { kind: 'regex-invalid', error: validateRegex(pattern) ?? 'invalid regex' });
    return;
  }

  // `in <field>` reads the fields as they stand at this point in the pass, so
  // an extraction can read what an earlier one (in class-name order) produced.
  const sourceValue = sourceField ? getFieldValue(event, state.fields, sourceField) : event._raw;
  if (!sourceValue) {
    warnStrippedSourceRef(state.fields, extraction, options);
    noteNoOp(state, directive, { kind: 'source-key-empty', sourceKey: sourceField ?? '_raw' });
    return;
  }

  // Inline EXTRACT takes the first match only.
  const m = regex.exec(sourceValue);
  if (!m && regex.lastError !== undefined) {
    noteNoOp(state, directive, { kind: 'regex-limit', error: regex.lastError });
    return;
  }
  if (m && !m.groups) {
    noteNoOp(state, directive, { kind: 'no-named-groups' });
    return;
  }
  if (!m?.groups) {
    const { pattern } = parseExtractValue(directive.value);
    const explain = options.explanations.take(
      noOpDirectiveKey({ file: 'props.conf', line: directive.line, directive: directive.key }),
    );
    noteNoOp(state, directive, explainNoMatch(pattern, sourceValue, explain));
    return;
  }
  // Offsets only authoritative when extracting from _raw — a captured position in a
  // derived source field cannot be translated back to _raw coordinates reliably.
  const isPositional = !sourceField;
  const indices = isPositional && options.captureOffsets ? m.indices.groups : undefined;
  storeGroups(directive, m.groups, indices, state);
}

export function parseExtractValue(value: string): { pattern: string; sourceField?: string } {
  const trimmed = value.trim();
  return splitInSuffix(trimmed) ?? { pattern: trimmed };
}

const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);

/**
 * `<pattern> in <field>`, read from the end. Only the last ` in <field>` splits,
 * so a regex body that holds the word "in" stays whole. The field may be single-
 * or double-quoted, so that a nested-JSON name with a period stays one token
 * (Splunk requires quotes for such names); the quotes are removed here. The
 * pattern is everything before the one whitespace character in front of `in`.
 * Read backward, because a regex for the same split backtracked through a long
 * run of whitespace once for each character before it (#20).
 */
function splitInSuffix(s: string): { pattern: string; sourceField: string } | null {
  let end = s.length;
  while (isSpace(s[end - 1])) end--;
  const last = s[end - 1];
  let start: number;
  if (last === "'" || last === '"') {
    start = end >= 2 ? s.lastIndexOf(last, end - 2) : -1;
    if (start < 0) return null;
  } else {
    start = end;
    while (start > 0 && /[\w.]/.test(s[start - 1] ?? '')) start--;
    if (start === end) return null;
  }
  let i = start;
  if (!isSpace(s[i - 1])) return null;
  while (isSpace(s[i - 1])) i--;
  if (i < 2 || s.slice(i - 2, i) !== 'in') return null;
  i -= 2;
  if (i < 2 || !isSpace(s[i - 1])) return null;
  return { pattern: s.slice(0, i - 1), sourceField: unquoteFieldName(s.slice(start, end)) };
}

/**
 * The value `in <field>` reads: from `fields`, which holds what the event
 * arrived with plus what earlier EXTRACTs in this pass produced, in class-name
 * order, as observed in Splunk (propslab#410): an EXTRACT whose class sorts before the
 * one producing the field finds nothing. Fields from KV_MODE are not here,
 * because automatic extraction runs after every EXTRACT.
 */
function getFieldValue(event: SplunkEvent, fields: SplunkEvent['fields'], fieldName: string): string | undefined {
  if (fieldName === '_raw') return event._raw;
  const val = getField(fields, fieldName);
  if (Array.isArray(val)) return val[0];
  // `EXTRACT-app = …(?<app>\w+)… in source` is a staple TA idiom: host/source/
  // sourcetype/index are default fields at search time, so extraction can run
  // against them without anything having extracted them first.
  if (val === undefined) return getMetadataField(event, fieldName);
  return val;
}
