import { describe, expect, it } from 'vitest';
import {
  constraintCoverage,
  ocsfPresentPaths,
  validateOcsfCoverage,
  type OcsfCoverageResult,
} from '../ocsf/ocsfClasses';
import {
  OCSF_BASE_EVENT,
  OCSF_CLASSES,
  OCSF_COMMIT,
  OCSF_OBJECT_TYPES,
  OCSF_OBJECTS,
  OCSF_VERSION,
} from '../ocsf/ocsfClassesData';

const coverage = (fields: string[], name: string): OcsfCoverageResult => {
  const found = validateOcsfCoverage(fields).find((r) => r.ocsfClass.name === name);
  if (!found) throw new Error(`no class ${name}`);
  return found;
};
const attribute = (result: OcsfCoverageResult, path: string) => {
  const top = path.split('.')[0];
  const parent = result.attributes.find((a) => a.path === top);
  const found = top === path ? parent : parent?.children?.find((a) => a.path === path);
  if (!found) throw new Error(`no attribute ${path}`);
  return found;
};

describe('the committed OCSF data (propslab-engine#31)', () => {
  it('is made from a pinned OCSF release', () => {
    expect(OCSF_VERSION).toBe('1.9.0');
    expect(OCSF_COMMIT).toBe('856d462bd20dc46cc1ffed2dfffe3b91ef0fbeba');
  });

  it('gives Authentication its class_uid, the category of its parent and its constraint', () => {
    const authentication = OCSF_CLASSES.find((c) => c.name === 'authentication');
    expect(authentication).toMatchObject({ uid: 3002, category: 'iam', caption: 'Authentication' });
    expect(authentication?.required).toContain('user');
    expect(authentication?.constraints).toEqual([{ kind: 'at_least_one', attributes: ['dst_endpoint', 'service'] }]);
  });

  it('has no deprecated class, and no attribute that comes only from a profile', () => {
    const names = OCSF_CLASSES.map((c) => c.name);
    expect(names).not.toContain('security_finding');
    expect(names).not.toContain('user_access');
    // `is_public` and `storage_class` come to File from the cloud profile.
    const file = OCSF_OBJECTS.find((o) => o.name === 'file')!;
    const fileNames = [...file.required, ...file.recommended, ...file.optional];
    expect(fileNames).toContain('path');
    expect(fileNames).not.toContain('is_public');
    expect(fileNames).not.toContain('storage_class');
  });

  it('keeps an attribute that a class declares of its own, with no profile', () => {
    const inventory = OCSF_CLASSES.find((c) => c.name === 'cloud_resources_inventory_info')!;
    expect([...inventory.required, ...inventory.recommended, ...inventory.optional]).toContain('cloud');
  });

  it('gives base_event its seven required attributes, which each class has', () => {
    expect(OCSF_BASE_EVENT.required).toEqual([
      'activity_id',
      'category_uid',
      'class_uid',
      'metadata',
      'severity_id',
      'time',
      'type_uid',
    ]);
    for (const c of OCSF_CLASSES) expect(c.required).toEqual(expect.arrayContaining(OCSF_BASE_EVENT.required));
  });

  it('has an object for each object attribute of a class, and a uid in class_uid order', () => {
    const objects = new Set(OCSF_OBJECTS.map((o) => o.name));
    for (const c of OCSF_CLASSES) {
      for (const name of [...c.required, ...c.recommended, ...c.optional]) {
        const type = OCSF_OBJECT_TYPES[name];
        if (type !== undefined) expect(objects).toContain(type);
      }
    }
    const uids = OCSF_CLASSES.map((c) => c.uid);
    expect(uids).toEqual([...uids].sort((a, b) => a - b));
  });
});

describe('ocsfPresentPaths', () => {
  it('gives each name and each part of it before a dot', () => {
    expect([...ocsfPresentPaths(['src_endpoint.location.city', 'time'])]).toEqual([
      'src_endpoint.location.city',
      'src_endpoint',
      'src_endpoint.location',
      'time',
    ]);
  });

  it('removes the array marker of the JSON extraction', () => {
    expect([...ocsfPresentPaths(['observables{}.name', 'tags{}'])]).toEqual([
      'observables.name',
      'observables',
      'tags',
    ]);
  });
});

describe('validateOcsfCoverage', () => {
  it('gives one result for each class, in class_uid order', () => {
    expect(validateOcsfCoverage([]).map((r) => r.ocsfClass.uid)).toEqual(OCSF_CLASSES.map((c) => c.uid));
  });

  it('counts an attribute as present when a field is its path or starts with its path and a dot', () => {
    const result = coverage(['src_endpoint.ip', 'user', 'time{}'], 'authentication');
    expect(attribute(result, 'src_endpoint').present).toBe(true);
    expect(attribute(result, 'user').present).toBe(true);
    expect(attribute(result, 'time').present).toBe(true);
    expect(attribute(result, 'dst_endpoint').present).toBe(false);
  });

  it('does not count a name that only starts with the path', () => {
    const result = coverage(['src_endpoint_ip', 'User'], 'authentication');
    expect(attribute(result, 'src_endpoint').present).toBe(false);
    expect(attribute(result, 'user').present).toBe(false);
  });

  it('gives the attributes of an object one level down, and marks an object two levels down', () => {
    const result = coverage(['src_endpoint.ip'], 'authentication');
    const endpoint = attribute(result, 'src_endpoint');
    expect(endpoint).toMatchObject({ object: 'network_endpoint', requirement: 'recommended' });
    expect(attribute(result, 'src_endpoint.ip').present).toBe(true);
    expect(attribute(result, 'src_endpoint.hostname').present).toBe(false);
    const location = attribute(result, 'src_endpoint.location');
    expect(location.object).toBe('location');
    expect(location.children).toBeUndefined();
    expect(attribute(result, 'time')).toStrictEqual({ path: 'time', requirement: 'required', present: false });
  });

  it('lists the attributes by requirement: required, then recommended, then optional', () => {
    const { attributes } = coverage([], 'authentication');
    const order = attributes.map((a) => a.requirement);
    expect(order.indexOf('recommended')).toBe(order.lastIndexOf('required') + 1);
    expect(order.indexOf('optional')).toBe(order.lastIndexOf('recommended') + 1);
  });

  it('splits the required and recommended attributes into present and missing, and gives the shares', () => {
    const result = coverage(['activity_id', 'user', 'src_endpoint.ip', 'is_mfa', 'auth_factors'], 'authentication');
    expect(result.requiredPresent).toEqual(['activity_id', 'user']);
    expect(result.requiredMissing).toEqual([
      'category_uid',
      'class_uid',
      'metadata',
      'severity_id',
      'time',
      'type_uid',
    ]);
    expect(result.recommendedPresent).toEqual(['is_mfa', 'src_endpoint']);
    const authentication = OCSF_CLASSES.find((c) => c.name === 'authentication')!;
    expect(result.recommendedMissing).toEqual(
      authentication.recommended.filter((name) => name !== 'is_mfa' && name !== 'src_endpoint'),
    );
    expect(result.recommendedMissing).not.toContain('auth_factors');
    expect(result.requiredPercent).toBe(25);
    // 4 of the 8 required and 21 recommended attributes.
    expect(result.totalPercent).toBe(14);
  });

  it('gives 0% with no field and 100% with every field', () => {
    const empty = coverage([], 'authentication');
    expect([empty.requiredPercent, empty.totalPercent]).toEqual([0, 0]);
    const all = OCSF_CLASSES.find((c) => c.name === 'authentication')!;
    const full = coverage([...all.required, ...all.recommended], 'authentication');
    expect([full.requiredPercent, full.totalPercent]).toEqual([100, 100]);
  });

  it('says if each constraint is satisfied', () => {
    expect(coverage([], 'authentication').constraints).toEqual([
      { kind: 'at_least_one', attributes: ['dst_endpoint', 'service'], satisfied: false },
    ]);
    expect(coverage(['service.name'], 'authentication').constraints[0]?.satisfied).toBe(true);
    expect(coverage(['service', 'dst_endpoint'], 'authentication').constraints[0]?.satisfied).toBe(true);
  });
});

describe('constraintCoverage', () => {
  const present = (...paths: string[]) => new Set(paths);
  const justOne = { kind: 'just_one' as const, attributes: ['a', 'b'] };
  const atLeastOne = { kind: 'at_least_one' as const, attributes: ['a', 'b'] };

  it('satisfies just_one with exactly one present path', () => {
    expect(constraintCoverage(justOne, present()).satisfied).toBe(false);
    expect(constraintCoverage(justOne, present('b')).satisfied).toBe(true);
    expect(constraintCoverage(justOne, present('a', 'b')).satisfied).toBe(false);
  });

  it('satisfies at_least_one with one or more present paths', () => {
    expect(constraintCoverage(atLeastOne, present('c')).satisfied).toBe(false);
    expect(constraintCoverage(atLeastOne, present('a')).satisfied).toBe(true);
    expect(constraintCoverage(atLeastOne, present('a', 'b')).satisfied).toBe(true);
  });
});
