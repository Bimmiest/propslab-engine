import {
  OCSF_CLASSES,
  OCSF_OBJECT_TYPES,
  OCSF_OBJECTS,
  type OcsfAttributeLists,
  type OcsfClass,
  type OcsfConstraint,
  type OcsfObject,
  type OcsfRequirement,
} from './ocsfClassesData';

/** An attribute of a class or of an object, and whether the events have it. */
export interface OcsfAttributeCoverage {
  /** The path from the class: `src_endpoint`, or `src_endpoint.ip` one level down. */
  path: string;
  requirement: OcsfRequirement;
  present: boolean;
  /** The object that the attribute is, when its type is an object. */
  object?: string;
  /** For an object attribute of the class: the attributes of the object, one level down. */
  children?: OcsfAttributeCoverage[];
}

export interface OcsfConstraintCoverage extends OcsfConstraint {
  satisfied: boolean;
}

export interface OcsfCoverageResult {
  ocsfClass: OcsfClass;
  /** The attributes of the class: the required ones, then the recommended, then the optional. */
  attributes: OcsfAttributeCoverage[];
  requiredPresent: string[];
  requiredMissing: string[];
  recommendedPresent: string[];
  recommendedMissing: string[];
  /** The share of the required attributes that are present, rounded. */
  requiredPercent: number;
  /** The share of the required and recommended attributes that are present, rounded. */
  totalPercent: number;
  constraints: OcsfConstraintCoverage[];
}

const REQUIREMENTS: readonly OcsfRequirement[] = ['required', 'recommended', 'optional'];

/**
 * The attribute paths that a set of field names makes present: each name, and
 * each part of it before a `.`. The JSON extraction marks an array with `{}`
 * (`observables{}.name`), and the marker is removed first, because an OCSF
 * path does not show arrays.
 */
export function ocsfPresentPaths(fieldNames: Iterable<string>): Set<string> {
  const paths = new Set<string>();
  for (const field of fieldNames) {
    const name = field.replaceAll('{}', '');
    paths.add(name);
    for (let dot = name.indexOf('.'); dot !== -1; dot = name.indexOf('.', dot + 1)) paths.add(name.slice(0, dot));
  }
  return paths;
}

// Each class has the required attributes of base_event, so no whole is 0.
const percent = (part: number, whole: number) => Math.round((part / whole) * 100);

function attributesOf(
  lists: OcsfAttributeLists,
  prefix: string,
  present: Set<string>,
  objects: ReadonlyMap<string, OcsfObject> | undefined,
): OcsfAttributeCoverage[] {
  return REQUIREMENTS.flatMap((requirement) =>
    lists[requirement].map((name) => {
      const path = prefix + name;
      const coverage: OcsfAttributeCoverage = { path, requirement, present: present.has(path) };
      const object = OCSF_OBJECT_TYPES[name];
      if (object === undefined) return coverage;
      coverage.object = object;
      const definition = objects?.get(object);
      if (definition) coverage.children = attributesOf(definition, `${path}.`, present, undefined);
      return coverage;
    }),
  );
}

/** Whether the present paths satisfy a constraint. No class of 1.9.0 has a `just_one`, but objects do. */
export function constraintCoverage(constraint: OcsfConstraint, present: Set<string>): OcsfConstraintCoverage {
  const count = constraint.attributes.filter((path) => present.has(path)).length;
  return { ...constraint, satisfied: constraint.kind === 'just_one' ? count === 1 : count > 0 };
}

/**
 * The OCSF coverage of each class, in class_uid order. It checks only that an
 * attribute is present, not its type or its value: an `activity_id` of 99 is
 * present. Profiles and extensions are not in the data.
 */
export function validateOcsfCoverage(extractedFields: Iterable<string>): OcsfCoverageResult[] {
  const present = ocsfPresentPaths(extractedFields);
  const objects = new Map(OCSF_OBJECTS.map((o) => [o.name, o]));
  return OCSF_CLASSES.map((ocsfClass) => {
    const attributes = attributesOf(ocsfClass, '', present, objects);
    const split = (requirement: OcsfRequirement, isPresent: boolean) =>
      attributes.filter((a) => a.requirement === requirement && a.present === isPresent).map((a) => a.path);
    const requiredPresent = split('required', true);
    const recommendedPresent = split('recommended', true);
    return {
      ocsfClass,
      attributes,
      requiredPresent,
      requiredMissing: split('required', false),
      recommendedPresent,
      recommendedMissing: split('recommended', false),
      requiredPercent: percent(requiredPresent.length, ocsfClass.required.length),
      totalPercent: percent(
        requiredPresent.length + recommendedPresent.length,
        ocsfClass.required.length + ocsfClass.recommended.length,
      ),
      constraints: ocsfClass.constraints.map((c) => constraintCoverage(c, present)),
    };
  });
}
