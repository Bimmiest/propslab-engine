#!/usr/bin/env node
// Makes src/ocsf/ocsfClassesData.ts again from a checkout of the OCSF schema.
//
// Usage:
//   1. git clone --depth 1 --branch <tag> https://github.com/ocsf/ocsf-schema /tmp/ocsf-schema
//   2. node scripts/generate-ocsf-classes.js /tmp/ocsf-schema
//   3. Read the diff, then run `npm test`. A test pins OCSF_VERSION.
//
// A maintainer runs this by hand when OCSF releases. Nothing runs it at build
// or install time, and the schema is not vendored. The schema is Apache-2.0
// (LICENSE-OCSF and NOTICE). The rules of the derivation are in the header
// that render() writes.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src/ocsf/ocsfClassesData.ts');

const REQUIREMENTS = ['required', 'recommended', 'optional'];
const CONSTRAINT_KINDS = ['at_least_one', 'just_one'];

// Throws, so that a test can drive the transformation. main() turns the error
// into a message and a non-zero exit.
function die(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function jsonFiles(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return jsonFiles(path);
      return name.endsWith('.json') ? [path] : [];
    });
}

/** The schema files, keyed by their `name`. */
function table(root, dir) {
  const out = new Map();
  for (const path of jsonFiles(join(root, dir))) {
    const doc = readJson(path);
    if (out.has(doc.name)) die(`two ${dir} files have the name ${doc.name}`);
    out.set(doc.name, { doc, path: relative(root, path).replaceAll('\\', '/') });
  }
  return out;
}

function locate(input) {
  for (const name of ['version.json', 'categories.json', 'dictionary.json', 'events', 'objects']) {
    if (!existsSync(join(input, name))) die(`${input} is not a checkout of ocsf-schema: it has no ${name}`);
  }
  const version = readJson(join(input, 'version.json')).version;
  if (typeof version !== 'string' || version === '') die(`no "version" in ${join(input, 'version.json')}`);
  return { root: input, version };
}

/**
 * The own attributes of a schema file. A profile `$include` is skipped, because
 * profiles are out of scope. Any other include stops the run: the rules below
 * do not cover it.
 */
function ownAttributes(entry) {
  const out = {};
  for (const [name, attribute] of Object.entries(entry.doc.attributes ?? {})) {
    if (name !== '$include') {
      out[name] = attribute;
      continue;
    }
    for (const include of [attribute].flat()) {
      if (!include.startsWith('profiles/')) die(`${entry.path} includes ${include}, which is not a profile`);
    }
  }
  return out;
}

/** A file with its `extends` chain resolved: each own attribute merges over the attribute of its parent. */
function resolveEntry(files, name, stack = []) {
  const entry = files.get(name);
  if (!entry) die(`${stack.at(-1) ?? 'the schema'} extends ${name}, which does not exist`);
  if (stack.includes(name)) die(`${[...stack, name].join(' -> ')} is a cycle`);
  const parent = entry.doc.extends ? resolveEntry(files, entry.doc.extends, [...stack, name]) : undefined;
  const attributes = { ...parent?.attributes };
  for (const [key, own] of Object.entries(ownAttributes(entry))) attributes[key] = { ...attributes[key], ...own };
  return {
    entry,
    attributes,
    category: entry.doc.category ?? parent?.category,
    constraints: entry.doc.constraints ?? parent?.constraints ?? {},
  };
}

/** The attribute names in each requirement, in name order. Deprecated and profile attributes are dropped. */
function byRequirement(resolved) {
  const out = { required: [], recommended: [], optional: [] };
  for (const [name, attribute] of Object.entries(resolved.attributes)) {
    if (attribute['@deprecated'] || attribute.profile) continue;
    const requirement = attribute.requirement;
    if (!REQUIREMENTS.includes(requirement)) {
      die(`${resolved.entry.path}: attribute ${name} has the requirement ${String(requirement)}`);
    }
    out[requirement].push(name);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}

function constraintsOf(resolved) {
  return Object.entries(resolved.constraints).map(([kind, attributes]) => {
    if (!CONSTRAINT_KINDS.includes(kind)) die(`${resolved.entry.path}: the constraint ${kind} is not known`);
    return { kind, attributes: [...attributes].sort() };
  });
}

/**
 * Each attribute name whose type is an object. The dictionary gives one type
 * for each name. A class or an object can change the type only to a narrower
 * scalar type, and this stops the run if one changes it to an object or away
 * from one.
 */
function objectTypes(dictionary, objects, files) {
  const types = new Map();
  for (const [name, attribute] of Object.entries(dictionary)) {
    if (objects.has(attribute.type)) types.set(name, attribute.type);
  }
  for (const entry of files) {
    for (const [name, attribute] of Object.entries(ownAttributes(entry))) {
      if (attribute.type === undefined) continue;
      if (objects.has(attribute.type) || types.has(name)) {
        die(`${entry.path}: attribute ${name} changes its type to ${attribute.type}`);
      }
    }
  }
  return types;
}

function checkNames(resolved, dictionary) {
  for (const name of Object.keys(resolved.attributes)) {
    if (!Object.hasOwn(dictionary, name)) die(`${resolved.entry.path}: attribute ${name} is not in dictionary.json`);
  }
}

function buildClass(resolved, categories) {
  const { doc, path } = resolved.entry;
  const category = categories[resolved.category];
  if (!category) die(`${path}: the category ${String(resolved.category)} is not in categories.json`);
  if (!Number.isInteger(doc.uid) || doc.uid < 0 || doc.uid > 999) die(`${path}: the uid ${doc.uid} is not 0 to 999`);
  return {
    uid: category.uid * 1000 + doc.uid,
    name: doc.name,
    caption: doc.caption,
    category: resolved.category,
    categoryCaption: category.caption,
    ...byRequirement(resolved),
    constraints: constraintsOf(resolved),
  };
}

function buildObject(resolved) {
  const { doc } = resolved.entry;
  return { name: doc.name, caption: doc.caption, ...byRequirement(resolved) };
}

const allNames = (entry) => [...entry.required, ...entry.recommended, ...entry.optional];

function build(root) {
  const dictionary = readJson(join(root, 'dictionary.json')).attributes;
  const categories = readJson(join(root, 'categories.json')).attributes;
  const events = table(root, 'events');
  const objects = table(root, 'objects');
  const types = objectTypes(dictionary, objects, [...events.values(), ...objects.values()]);

  const resolvedBase = resolveEntry(events, 'base_event');
  checkNames(resolvedBase, dictionary);
  const base = buildObject(resolvedBase);

  const classes = [];
  for (const [name, entry] of events) {
    if (entry.doc.uid === undefined || name === 'base_event' || entry.doc['@deprecated']) continue;
    const resolved = resolveEntry(events, name);
    checkNames(resolved, dictionary);
    classes.push(buildClass(resolved, categories));
  }
  classes.sort((a, b) => a.uid - b.uid);
  const uids = new Set(classes.map((c) => c.uid));
  if (uids.size !== classes.length) die('two classes have the same class_uid');

  // One level down from each class: the objects that its own attributes are.
  const used = new Set(classes.flatMap((c) => allNames(c).flatMap((n) => (types.has(n) ? [types.get(n)] : []))));
  const usedObjects = [...used].sort().map((name) => {
    const resolved = resolveEntry(objects, name);
    checkNames(resolved, dictionary);
    return buildObject(resolved);
  });

  const named = new Set([...classes, ...usedObjects, base].flatMap(allNames));
  const objectTypeTable = Object.fromEntries(
    [...named]
      .filter((n) => types.has(n))
      .sort()
      .map((n) => [n, types.get(n)]),
  );
  return { base, classes, objects: usedObjects, objectTypes: objectTypeTable };
}

const HEADER = [
  '// The event classes of the Open Cybersecurity Schema Framework (OCSF), made',
  '// by scripts/generate-ocsf-classes.js from the ocsf-schema repository. Do not',
  '// change this file by hand: run the script again (docs/recipes.md, "Add or',
  '// update the OCSF classes").',
  '//',
  '// LICENCE: the schema is Copyright OCSF a Series of LF Projects, LLC, under',
  '// the Apache License 2.0 (LICENSE-OCSF). This file is a derivative work',
  '// of the schema: it holds its names and requirements in a different form.',
  '// NOTICE gives the attribution.',
  '//',
  '// The rules of the derivation (propslab-engine#31):',
  '//',
  '//   * A class is a file in events/ with a uid, other than base_event and other',
  '//     than a deprecated class. Its uid here is its class_uid: the uid of its',
  '//     category times 1000, plus its own uid.',
  '//   * The attributes of a class are its own and those of each file that it',
  '//     extends. An own attribute merges over the attribute of the parent.',
  '//   * Profiles and extensions are left out: an attribute with a profile, and',
  '//     each $include of a profile. Deprecated attributes are left out.',
  '//   * Each list is in name order. Descriptions are left out.',
  '//   * OCSF_OBJECTS has each object that an attribute of a class is, with its',
  '//     attributes by the same rules. It goes one level down, no further.',
  '//   * OCSF_OBJECT_TYPES gives the object of each attribute name in this file',
  '//     whose type is an object. dictionary.json gives one type for each name.',
];

function renderEntry(out, entry, fields) {
  out.push('  {');
  for (const field of fields) out.push(`    ${field}: ${JSON.stringify(entry[field])},`);
  out.push('  },');
}

const LIST_FIELDS = ['required', 'recommended', 'optional'];

function renderTypes(out) {
  out.push("export type OcsfRequirement = 'required' | 'recommended' | 'optional';");
  out.push('');
  out.push('/** The attribute names of a class or an object, by requirement. */');
  out.push('export interface OcsfAttributeLists {');
  for (const field of LIST_FIELDS) out.push(`  ${field}: string[];`);
  out.push('}');
  out.push('');
  out.push('/** A rule over a set of attribute paths: at least one, or exactly one, of them is present. */');
  out.push('export interface OcsfConstraint {');
  out.push("  kind: 'at_least_one' | 'just_one';");
  out.push('  attributes: string[];');
  out.push('}');
  out.push('');
  out.push('export interface OcsfClass extends OcsfAttributeLists {');
  out.push('  /** The class_uid. */');
  out.push('  uid: number;');
  out.push('  name: string;');
  out.push('  caption: string;');
  out.push('  category: string;');
  out.push('  categoryCaption: string;');
  out.push('  constraints: OcsfConstraint[];');
  out.push('}');
  out.push('');
  out.push('export interface OcsfObject extends OcsfAttributeLists {');
  out.push('  name: string;');
  out.push('  caption: string;');
  out.push('}');
}

/** The source text of ocsfClassesData.ts. `data` is what build() returns, with `version` and `commit`. */
function render(data) {
  const out = [...HEADER, ''];
  renderTypes(out);
  out.push('');
  out.push('/** The OCSF release that this file was made from. */');
  out.push(`export const OCSF_VERSION = ${JSON.stringify(data.version)};`);
  out.push('');
  out.push('/** The commit of ocsf-schema that this file was made from. */');
  out.push(`export const OCSF_COMMIT = ${JSON.stringify(data.commit)};`);
  out.push('');
  out.push('/** The attributes of base_event, which each class has. */');
  out.push('export const OCSF_BASE_EVENT: OcsfObject = {');
  for (const field of ['name', 'caption', ...LIST_FIELDS]) out.push(`  ${field}: ${JSON.stringify(data.base[field])},`);
  out.push('};');
  out.push('');
  out.push('export const OCSF_CLASSES: OcsfClass[] = [');
  for (const c of data.classes) {
    renderEntry(out, c, ['uid', 'name', 'caption', 'category', 'categoryCaption', ...LIST_FIELDS, 'constraints']);
  }
  out.push('];');
  out.push('');
  out.push('export const OCSF_OBJECTS: OcsfObject[] = [');
  for (const o of data.objects) renderEntry(out, o, ['name', 'caption', ...LIST_FIELDS]);
  out.push('];');
  out.push('');
  out.push('export const OCSF_OBJECT_TYPES: Record<string, string> = {');
  for (const [name, type] of Object.entries(data.objectTypes)) out.push(`  ${name}: ${JSON.stringify(type)},`);
  out.push('};');
  out.push('');
  return out.join('\n');
}

export { locate, build, render };

function main() {
  const input = process.argv[2];
  if (!input) die('usage: node scripts/generate-ocsf-classes.js <path-to-a-checkout-of-ocsf-schema>');
  const { root, version } = locate(resolve(input));
  let commit;
  try {
    commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    die(`${root} is not a git checkout, so the commit cannot be recorded`);
  }
  const data = build(root);
  writeFileSync(OUTPUT, render({ ...data, version, commit }));
  console.error(
    `OCSF ${version}: wrote ${data.classes.length} classes and ${data.objects.length} objects to ${OUTPUT}`,
  );
}

// Importing this file, as the test does, writes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
