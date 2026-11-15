import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OCSF_BASE_EVENT,
  OCSF_CLASSES,
  OCSF_COMMIT,
  OCSF_OBJECT_TYPES,
  OCSF_OBJECTS,
  OCSF_VERSION,
  type OcsfClass,
  type OcsfObject,
} from '../ocsf/ocsfClassesData';

/**
 * The OCSF generator (propslab-engine#31).
 *
 * The schema is public, but CI does not fetch it. This tests the
 * transformation on a small schema in `fixtures/ocsf`, with classes that we
 * made, and the format: render() must write the committed file byte for byte
 * from its contents. A person compares the data with a new schema release
 * (docs/recipes.md, "Add or update the OCSF classes").
 */

interface Data {
  base: OcsfObject;
  classes: OcsfClass[];
  objects: OcsfObject[];
  objectTypes: Record<string, string>;
}
interface Generator {
  locate: (input: string) => { root: string; version: string };
  build: (root: string) => Data;
  render: (data: Data & { version: string; commit: string }) => string;
}

const scripts = import.meta.glob<Generator>('/scripts/generate-ocsf-classes.js', { eager: true });
const { locate, build, render } = scripts['/scripts/generate-ocsf-classes.js']!;
const committedFiles = import.meta.glob<string>('/src/ocsf/ocsfClassesData.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const committed = committedFiles['/src/ocsf/ocsfClassesData.ts']!;

const fixture = (): string => {
  const path = decodeURIComponent(new URL('./fixtures/ocsf', import.meta.url).pathname);
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path;
};

const byName = <T extends { name: string }>(list: T[], name: string): T => {
  const found = list.find((e) => e.name === name);
  if (!found) throw new Error(`no entry ${name}`);
  return found;
};

describe('generate-ocsf-classes: locate', () => {
  it('takes the version from version.json', () => {
    expect(locate(fixture())).toEqual({ root: fixture(), version: '0.0.1-test' });
  });

  it('refuses a directory that is not a checkout of the schema', () => {
    expect(() => locate(join(fixture(), 'events'))).toThrow(
      /is not a checkout of ocsf-schema: it has no version\.json/,
    );
  });
});

describe('generate-ocsf-classes: build', () => {
  it('makes a class of each event file with a uid, except base_event and deprecated classes', () => {
    expect(build(fixture()).classes.map((c) => [c.uid, c.name])).toEqual([
      [8003, 'gizmo_tick'],
      [9001, 'widget_spin'],
    ]);
  });

  it('takes the category, the attributes and the constraints from the files that a class extends', () => {
    const spin = byName(build(fixture()).classes, 'widget_spin');
    expect(spin).toMatchObject({ caption: 'Widget Spin', category: 'widgets', categoryCaption: 'Widget Activity' });
    expect(spin.constraints).toEqual([{ kind: 'at_least_one', attributes: ['actor', 'gadget'] }]);
  });

  // An own attribute merges over the parent's: `actor` becomes required, and
  // `message` keeps the requirement of base_event under a new description.
  it('merges each own attribute over the attribute of its parent', () => {
    const spin = byName(build(fixture()).classes, 'widget_spin');
    expect(spin.required).toEqual(['activity_id', 'actor', 'class_uid', 'gadget', 'time']);
    expect(spin.recommended).toEqual(['message']);
  });

  it('leaves out deprecated attributes, profile attributes and profile includes', () => {
    const spin = byName(build(fixture()).classes, 'widget_spin');
    expect(spin.optional).toEqual(['raw_data', 'size']);
    const names = [...spin.required, ...spin.recommended, ...spin.optional];
    expect(names).not.toContain('old_thing');
    expect(names).not.toContain('cloud_thing');
  });

  it('gives a just_one constraint, in name order', () => {
    expect(byName(build(fixture()).classes, 'gizmo_tick').constraints).toEqual([
      { kind: 'just_one', attributes: ['spare_a', 'spare_b'] },
    ]);
  });

  it('gives base_event by the same rules', () => {
    expect(build(fixture()).base).toEqual({
      name: 'base_event',
      caption: 'Base Event',
      required: ['activity_id', 'class_uid', 'time'],
      recommended: ['message'],
      optional: ['raw_data'],
    });
  });

  // `part` is an attribute of `gadget`, not of a class, so it is two levels
  // down: its name is in the type table, and the object is not.
  it('gives the objects that the attributes of a class are, one level down only', () => {
    const { objects, objectTypes } = build(fixture());
    expect(objects.map((o) => o.name)).toEqual(['actor', 'gadget']);
    expect(byName(objects, 'actor')).toEqual({
      name: 'actor',
      caption: 'Actor',
      required: ['owner'],
      recommended: ['name', 'uid'],
      optional: [],
    });
    expect(byName(objects, 'gadget').optional).toEqual(['part', 'size']);
    expect(objectTypes).toEqual({ actor: 'actor', gadget: 'gadget', part: 'part' });
  });
});

describe('generate-ocsf-classes: build refuses a schema that its rules do not cover', () => {
  let root = '';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ocsf-'));
    cpSync(fixture(), root, { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  interface SchemaFile {
    attributes: Record<string, unknown>;
    category?: string;
    constraints?: Record<string, string[]>;
    extends?: string;
    uid?: number;
  }
  const edit = (file: string, change: (doc: SchemaFile) => void) => {
    const path = join(root, file);
    const doc = JSON.parse(readFileSync(path, 'utf8')) as SchemaFile;
    change(doc);
    writeFileSync(path, JSON.stringify(doc));
  };
  const setAttribute = (file: string, name: string, value: unknown) =>
    edit(file, (d) => Object.assign(d.attributes, { [name]: value }));
  const TICK = 'events/gizmos/gizmo_tick.json';

  it('an include that is not a profile', () => {
    setAttribute(TICK, '$include', ['includes/thing.json']);
    expect(() => build(root)).toThrow(/gizmo_tick\.json includes includes\/thing\.json, which is not a profile/);
  });

  it('a parent that does not exist, and a cycle', () => {
    edit(TICK, (d) => (d.extends = 'gone'));
    expect(() => build(root)).toThrow(/gizmo_tick extends gone, which does not exist/);
    edit(TICK, (d) => (d.extends = 'gizmo_tick'));
    expect(() => build(root)).toThrow(/gizmo_tick -> gizmo_tick is a cycle/);
  });

  it('a constraint that it does not know', () => {
    edit(TICK, (d) => (d.constraints = { all_of: ['spare_a'] }));
    expect(() => build(root)).toThrow(/the constraint all_of is not known/);
  });

  it('an attribute with no requirement, or with a name that is not in the dictionary', () => {
    setAttribute(TICK, 'spare_a', {});
    expect(() => build(root)).toThrow(/attribute spare_a has the requirement undefined/);
    setAttribute(TICK, 'spare_a', { requirement: 'often' });
    expect(() => build(root)).toThrow(/attribute spare_a has the requirement often/);
    setAttribute(TICK, 'mystery', { requirement: 'optional' });
    expect(() => build(root)).toThrow(/attribute mystery is not in dictionary\.json/);
  });

  it('an attribute whose type changes to an object, or away from one', () => {
    setAttribute('objects/gadget.json', 'colour', { requirement: 'recommended', type: 'part' });
    expect(() => build(root)).toThrow(/gadget\.json: attribute colour changes its type to part/);
    setAttribute('objects/gadget.json', 'colour', { requirement: 'recommended' });
    setAttribute(TICK, 'actor', { requirement: 'optional', type: 'string_t' });
    expect(() => build(root)).toThrow(/gizmo_tick\.json: attribute actor changes its type to string_t/);
  });

  it('a category that is not in categories.json, and a uid that is not 0 to 999', () => {
    edit(TICK, (d) => (d.category = 'doohickeys'));
    expect(() => build(root)).toThrow(/the category doohickeys is not in categories\.json/);
    edit(TICK, (d) => {
      d.category = 'gizmos';
      d.uid = 1000;
    });
    expect(() => build(root)).toThrow(/the uid 1000 is not 0 to 999/);
  });

  it('two classes with one class_uid, and two files with one name', () => {
    edit(TICK, (d) => {
      d.category = 'widgets';
      d.uid = 1;
    });
    expect(() => build(root)).toThrow(/two classes have the same class_uid/);
    cpSync(join(root, 'objects/part.json'), join(root, 'objects/part_again.json'));
    expect(() => build(root)).toThrow(/two objects files have the name part/);
  });
});

describe('generate-ocsf-classes: render', () => {
  const out = () => render({ ...build(fixture()), version: '9.9.9', commit: 'abc123' });

  it('writes the version and the commit', () => {
    expect(out()).toContain('export const OCSF_VERSION = "9.9.9";');
    expect(out()).toContain('export const OCSF_COMMIT = "abc123";');
  });

  it('writes each list on one line, and the licence notice', () => {
    expect(out()).toContain('    required: ["activity_id","actor","class_uid","gadget","time"],');
    expect(out()).toMatch(/\/\/ LICENCE: the schema is Copyright OCSF a Series of LF Projects, LLC/);
  });
});

describe('generate-ocsf-classes: the committed ocsfClassesData.ts', () => {
  it('is what render() writes for its own contents', () => {
    const data = {
      base: OCSF_BASE_EVENT,
      classes: OCSF_CLASSES,
      objects: OCSF_OBJECTS,
      objectTypes: OCSF_OBJECT_TYPES,
      version: OCSF_VERSION,
      commit: OCSF_COMMIT,
    };
    expect(render(data)).toBe(committed);
  });
});
