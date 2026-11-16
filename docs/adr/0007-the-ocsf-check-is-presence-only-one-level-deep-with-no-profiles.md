# 0007. The OCSF check is presence only, one level deep, with no profiles

- **Status:** Accepted
- **Date:** 2026-11-15
- **Issue:** #31

## Context

[propslab#892](https://github.com/Bimmiest/propslab/issues/892) asks for a
view that checks the extracted fields against an OCSF event class, as the CIM
view checks them against a CIM dataset. The data and the rule must be the
same for each consumer, so they go in the engine.

OCSF is different from the CIM in four ways:

- An attribute can be an object, and an object has attributes. A path such as
  `src_endpoint.ip` names an attribute of an object. A CIM field has a flat
  name.
- Some attributes have a type and a fixed set of values (`activity_id`,
  `severity_id`).
- A profile or an extension adds attributes to a class.
- The schema is public, under Apache-2.0. A generator can read a pinned
  release, and CI can test the generator.

Release 1.9.0 has 79 classes, and 22 of them are deprecated. A class has
about 37 attributes of its own. When each required or recommended object is
expanded three levels down, a class has about 250 attributes, and the largest
has 891.

## Decision

1. **The data comes from a pinned release.**
   `scripts/generate-ocsf-classes.js` reads a checkout of `ocsf-schema`, and
   writes `src/ocsf/ocsfClassesData.ts`. The file records the version and the
   commit, and a test pins them.
2. **An attribute is present when a field name is its path, or starts with
   its path and a `.`.** The `{}` array marker of the JSON extraction is
   removed first. The comparison is case-sensitive.
3. **The check goes one level into an object.** A class has its own
   attributes. An object attribute of a class has the attributes of its
   object. The check does not go further.
4. **The check is for presence only.** It does not check types or values.
5. **Profiles, extensions, deprecated classes and deprecated attributes are
   left out.**
6. **Constraints are kept.** The result says if each `at_least_one` and
   `just_one` is satisfied.

## Consequences

- An attribute with a wrong value passes. An `activity_id` of `99` is
  present. The API documentation and propslab's view must say so.
- A class that a profile changes is not shown with the profile. For example,
  the `cloud` profile adds `cloud` to each class, and the data does not have
  it.
- A missing attribute two levels down has no result. The user sees that
  `src_endpoint.location` is missing, and not which attributes of `location`
  are missing.
- The data is about 11 kB gzip. A consumer that loads it at startup pays for
  it. propslab loads it with its view.
- The generator stops on a part of the schema that the rules do not cover.
  Thus a new OCSF release can need a change to the script before the data
  can change.
- Each consumer that distributes the data must carry the OCSF section of
  `NOTICE` and `LICENSE-OCSF`.
