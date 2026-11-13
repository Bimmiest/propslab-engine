import type { Confidence, ScaffoldSuggestion } from '../types';
import { escapeRegex } from '../../utils/splunkRegex';

/**
 * Detect the line/event format and propose the matching props.conf directives
 * (KV_MODE / INDEXED_EXTRACTIONS / LINE_BREAKER / SHOULD_LINEMERGE).
 *
 * Precedent — INDEXED_EXTRACTIONS vs KV_MODE (Splunk guidance: prefer search-time
 * extraction unless index-time is specifically needed):
 *   • Delimited files (CSV / TSV / PSV / W3C) → INDEXED_EXTRACTIONS. They require
 *     index-time structured parsing; there is no search-time KV_MODE equivalent.
 *   • JSON / XML / key=value → KV_MODE (search-time). Flexible, no index bloat, no
 *     extra storage/license cost. We deliberately do NOT propose
 *     INDEXED_EXTRACTIONS=json — and never both (that double-extracts and
 *     duplicates field values). Index-time JSON is a niche choice (e.g. tstats /
 *     accelerated data models) left to the engineer.
 */
export function detectLineFormat(rawData: string, lines: string[]): ScaffoldSuggestion[] {
  const nonBlank = lines.filter((l) => l.trim().length > 0);
  if (nonBlank.length === 0) return [];

  // XML — declaration or a leading element.
  if (/<\?xml/i.test(rawData) || /^\s*<[a-zA-Z!]/.test(rawData)) return xmlSuggestions(rawData);

  // JSON, one object per line.
  const jsonLines = nonBlank.filter(isJsonLine).length;
  const jsonRatio = jsonLines / nonBlank.length;
  if (jsonRatio >= 0.8) {
    return [
      {
        key: 'LINE_BREAKER',
        value: '([\\r\\n]+)',
        confidence: 'medium',
        evidence: 'One JSON object per line — break on newlines',
        enabledByDefault: true,
      },
      {
        key: 'SHOULD_LINEMERGE',
        value: 'false',
        confidence: 'high',
        evidence: 'JSON events are a single line each; do not merge',
        enabledByDefault: true,
      },
      {
        key: 'KV_MODE',
        value: 'json',
        confidence: jsonRatio === 1 ? 'high' : 'medium',
        evidence: `${jsonLines}/${nonBlank.length} lines parse as JSON — search-time KV_MODE preferred over INDEXED_EXTRACTIONS (no index bloat)`,
        enabledByDefault: true,
      },
    ];
  }

  // Multi-line JSON objects, one or several (`}` … `{` across lines). Each object
  // spans several lines, so the per-line JSON check above misses them. Even a
  // single object needs the breaker: under the default line merge
  // (BREAK_ONLY_BEFORE_DATE) it would split at any line holding a date.
  const trimmed = rawData.trim();
  // Horizontal whitespace up to the first line break, so that `\s` and the
  // break cannot share a run of blank lines and backtrack through it (#20).
  const several = /\}[^\S\r\n]*[\r\n]\s*\{/.test(rawData);
  if (trimmed.startsWith('{') && (several || (nonBlank.length > 1 && tryParse(trimmed)))) {
    return multiLineJsonSuggestions(several);
  }

  // CEF and LEEF, before the delimiter check: their headers are pipe-separated,
  // and as PSV the first data line would become the header row (propslab#758).
  const header = headerFormatSuggestions(nonBlank);
  if (header) return header;

  // Delimited (CSV / TSV / PSV).
  const delim = detectDelimiter(nonBlank);
  if (delim) {
    return [
      {
        key: 'INDEXED_EXTRACTIONS',
        value: delim.format,
        confidence: delim.confidence,
        evidence: `${delim.evidence} — delimited files use index-time structured extraction`,
        enabledByDefault: true,
      },
    ];
  }

  // Whitespace-indented continuation lines → merge into the preceding event.
  const continuation = nonBlank.filter((l) => /^\s/.test(l)).length;
  if (continuation > 0 && continuation / nonBlank.length >= 0.1) {
    return [
      {
        key: 'SHOULD_LINEMERGE',
        value: 'true',
        confidence: 'medium',
        evidence: `${continuation} line(s) start with whitespace (continuations)`,
        enabledByDefault: true,
      },
      {
        key: 'BREAK_ONLY_BEFORE',
        value: '^\\S',
        confidence: 'medium',
        evidence: 'Start a new event only on a non-indented line',
        enabledByDefault: true,
      },
    ];
  }

  return [];
}

/** A CEF header, at the start of the line or behind a syslog header. */
export const CEF_HEADER = /(?:^|\s)CEF:\d+\|/;
/** A LEEF 1.0 or 2.0 header, likewise. */
export const LEEF_HEADER = /(?:^|\s)LEEF:[12]\.0\|/;

/** The fixed header fields of each format, in order, after the version. */
const HEADER_FIELDS = {
  CEF: [
    'cef_device_vendor',
    'cef_device_product',
    'cef_device_version',
    'cef_signature_id',
    'cef_name',
    'cef_severity',
  ],
  LEEF: ['leef_vendor', 'leef_product', 'leef_product_version', 'leef_event_id'],
};

/** One header field: a backslash escapes the next character, as CEF writes a `|` in a field as `\|`. */
const HEADER_FIELD = '(?:\\\\.|[^\\\\|])*';

/**
 * One event per line, and an EXTRACT for the fixed header fields. KV_MODE =
 * auto, the default, reads the extension's pairs that follow a space, but not
 * the first, which follows the header's last `|`: a key starts only after a
 * space, `,`, `;` or `:` (kvMode.ts). Reading every pair needs a REPORT in
 * transforms.conf, which the Scaffold does not write.
 */
function headerFormatSuggestions(nonBlank: string[]): ScaffoldSuggestion[] | null {
  const share = (header: RegExp) => nonBlank.filter((l) => header.test(l)).length;
  const cef = share(CEF_HEADER);
  const leef = share(LEEF_HEADER);
  const [format, count] = cef >= leef ? (['CEF', cef] as const) : (['LEEF', leef] as const);
  if (count / nonBlank.length < 0.8) return null;
  const prefix = format.toLowerCase();
  const fields = HEADER_FIELDS[format].map((name) => `\\|(?<${name}>${HEADER_FIELD})`).join('');
  return [
    {
      key: 'LINE_BREAKER',
      value: '([\\r\\n]+)',
      confidence: 'high',
      evidence: `${format} writes one event per line`,
      enabledByDefault: true,
    },
    {
      key: 'SHOULD_LINEMERGE',
      value: 'false',
      confidence: 'high',
      evidence: `${format} events are a single line each; do not merge`,
      enabledByDefault: true,
    },
    {
      key: `EXTRACT-${prefix}_header`,
      value: `${format}:(?<${prefix}_version>[\\d.]+)${fields}\\|`,
      confidence: 'medium',
      evidence: `${count}/${nonBlank.length} lines carry a ${format} header: extract its fields. KV_MODE = auto, the default, reads the extension's pairs after the first`,
      enabledByDefault: true,
    },
  ];
}

/** KV_MODE = xml, and a LINE_BREAKER when the documents in the sample can be told apart. */
function xmlSuggestions(rawData: string): ScaffoldSuggestion[] {
  const kvMode: ScaffoldSuggestion = {
    key: 'KV_MODE',
    value: 'xml',
    confidence: 'high',
    evidence: 'Input looks like XML',
    enabledByDefault: true,
  };
  // Without an explicit breaker the default line merge (BREAK_ONLY_BEFORE_DATE)
  // splits a multi-line document at any line holding a date.
  const breaker = xmlDocumentBreaker(rawData);
  if (!breaker) return [kvMode];
  return [
    {
      key: 'LINE_BREAKER',
      value: breaker.regex,
      confidence: 'medium',
      evidence: breaker.evidence,
      enabledByDefault: true,
    },
    {
      key: 'SHOULD_LINEMERGE',
      value: 'false',
      confidence: 'medium',
      evidence: 'Events are delimited by the LINE_BREAKER, not merged',
      enabledByDefault: true,
    },
    kvMode,
  ];
}

/** Break before each top-level `{`, whether the sample holds several objects or one spread over lines. */
function multiLineJsonSuggestions(several: boolean): ScaffoldSuggestion[] {
  return [
    {
      key: 'LINE_BREAKER',
      value: '([\\r\\n]+)(?=\\{)',
      confidence: 'medium',
      evidence: several
        ? 'Multiple newline-separated JSON objects — break before each one'
        : 'Multi-line JSON object — break only before a top-level `{`, so the object stays whole',
      enabledByDefault: true,
    },
    {
      key: 'SHOULD_LINEMERGE',
      value: 'false',
      confidence: 'medium',
      evidence: 'Events are delimited by the LINE_BREAKER, not merged',
      enabledByDefault: true,
    },
    { key: 'KV_MODE', value: 'json', confidence: 'medium', evidence: 'JSON payload', enabledByDefault: true },
  ];
}

/**
 * A LINE_BREAKER that breaks only before each top-level XML document, or null
 * when the sample's top level cannot be read. When every document opens with an
 * XML declaration the break is before it, so the declaration stays with its
 * root; otherwise it is before the root element names seen at depth 0. Like the
 * JSON breaker, it assumes each document starts at column 0.
 */
export interface XmlElementTag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

/**
 * The element tags of a sample, in order. Comments, CDATA, declarations and
 * processing instructions are skipped, and give no tag. A scanner rather than
 * one regex, because a regex rescanned the rest of the sample from each
 * unterminated `<!--`, `<?` or quoted attribute (#20). Here each terminator is
 * searched for after the previous find, and once absent it stays absent; an
 * element stops at the next `<`, also inside a quoted attribute value, where
 * XML does not allow it. So each character is read a bounded number of times.
 */
export function xmlElementTags(raw: string): XmlElementTag[] {
  const found = new Map<string, number>();
  const next = (terminator: string, from: number): number => {
    const at = found.get(terminator);
    if (at === -1 || (at !== undefined && at >= from)) return at;
    const index = raw.indexOf(terminator, from);
    found.set(terminator, index);
    return index;
  };
  const tags: XmlElementTag[] = [];
  let i = raw.indexOf('<');
  while (i !== -1) {
    let resume = i + 1;
    let end: number;
    if (raw.startsWith('<!--', i) && (end = next('-->', i + 4)) !== -1) resume = end + 3;
    else if (raw.startsWith('<![CDATA[', i) && (end = next(']]>', i + 9)) !== -1) resume = end + 3;
    else if ((raw[i + 1] === '?' || raw[i + 1] === '!') && (end = next('>', i + 2)) !== -1) resume = end + 1;
    else {
      const element = readElementTag(raw, i);
      if (element) {
        tags.push(element.tag);
        resume = element.end;
      }
    }
    i = raw.indexOf('<', resume);
  }
  return tags;
}

/** The element tag that starts at `raw[i]` (a `<`), and the index after it; null if there is none. */
function readElementTag(raw: string, i: number): { tag: XmlElementTag; end: number } | null {
  let p = i + 1;
  const closing = raw[p] === '/';
  if (closing) p++;
  if (!/[A-Za-z_]/.test(raw[p] ?? '')) return null;
  const nameStart = p++;
  while (/[\w.:-]/.test(raw[p] ?? '')) p++;
  const name = raw.slice(nameStart, p);
  for (;;) {
    const c = raw[p];
    if (c === undefined || c === '<') return null;
    if (c === '>') return { tag: { name, closing, selfClosing: false }, end: p + 1 };
    if (c === '/' && raw[p + 1] === '>') return { tag: { name, closing, selfClosing: true }, end: p + 2 };
    if (c === '"' || c === "'") {
      let q = p + 1;
      while (q < raw.length && raw[q] !== c && raw[q] !== '<') q++;
      if (raw[q] !== c) return null;
      p = q + 1;
    } else p++;
  }
}

function xmlDocumentBreaker(rawData: string): { regex: string; evidence: string } | null {
  const roots = new Set<string>();
  let rootCount = 0;
  let depth = 0;
  for (const tag of xmlElementTags(rawData)) {
    if (tag.closing) {
      if (--depth < 0) return null;
      continue;
    }
    if (depth === 0) {
      roots.add(tag.name);
      rootCount++;
    }
    if (!tag.selfClosing) depth++;
  }
  if (rootCount === 0) return null;

  // Horizontal whitespace after the line break, for the reason above (#20).
  const declarations = rawData.match(/(?:^|[\r\n])[^\S\r\n]*<\?xml\s/gi)?.length ?? 0;
  if (declarations === rootCount) {
    return {
      regex: '([\\r\\n]+)(?=<\\?xml\\s)',
      evidence: 'Each XML document opens with a declaration — break only before each one',
    };
  }
  // Some documents carry a declaration and some do not: breaking before the
  // root would strand a declaration as an event of its own.
  if (declarations > 0) return null;

  const names = [...roots].map(escapeRegex).join('|');
  const alternation = roots.size === 1 ? names : `(?:${names})`;
  return {
    regex: `([\\r\\n]+)(?=<${alternation}[\\s/>])`,
    evidence: `Top-level XML element${roots.size === 1 ? '' : 's'} ${[...roots].map((n) => `<${n}>`).join(', ')} — break only before each one`,
  };
}

function isJsonLine(line: string): boolean {
  const t = line.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return false;
  return tryParse(t);
}

function tryParse(text: string): boolean {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null;
  } catch {
    return false;
  }
}

function countChar(line: string, ch: string): number {
  let n = 0;
  for (const c of line) if (c === ch) n++;
  return n;
}

function detectDelimiter(lines: string[]): { format: string; confidence: Confidence; evidence: string } | null {
  // Delimited detection needs a header plus at least one data row; a single
  // comma-containing line (e.g. prose) must not be mistaken for CSV.
  if (lines.length < 2) return null;
  const candidates: Array<[string, string]> = [
    [',', 'csv'],
    ['\t', 'tsv'],
    ['|', 'psv'],
  ];
  const sample = lines.slice(0, 50);
  let best: { format: string; confidence: Confidence; evidence: string; score: number } | null = null;

  for (const [ch, format] of candidates) {
    const counts = sample.map((l) => countChar(l, ch));
    const headerCount = counts[0] ?? 0;
    if (headerCount < 1) continue;
    const consistent = counts.filter((c) => c === headerCount).length;
    const ratio = consistent / counts.length;
    if (ratio < 0.7) continue;
    const score = ratio * headerCount;
    if (!best || score > best.score) {
      best = {
        format,
        confidence: ratio >= 0.95 ? 'high' : 'medium',
        evidence: `Consistent ${headerCount + 1} ${format.toUpperCase()} columns across ${consistent}/${counts.length} lines`,
        score,
      };
    }
  }
  return best ? { format: best.format, confidence: best.confidence, evidence: best.evidence } : null;
}
