// The static imports of a module, and the files they name. propslab walks its
// startup bundle with these (propslab#467); here, scripts/lib/mutationTargets.mjs
// reads which sources a changed test imports.

import { dirname, posix } from 'node:path';

// Static imports: `import{a as b}from"./x.js"`, `import"./x.js"`,
// `export{a}from"./x.js"`, `export*from"./x.js"`. `import("./x.js")` has a
// parenthesis before the string and does not match.
const STATIC_IMPORT = /\b(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["']([^"']+)["']/g;

/**
 * The relative or absolute specifiers a module imports statically. Dynamic
 * `import()` is the lazy path and is deliberately not returned; bare
 * specifiers (packages) are not files of the build and are not either.
 * @param {string} source
 * @returns {string[]}
 */
export function staticImports(source) {
  return [...source.matchAll(STATIC_IMPORT)]
    .map(([, spec]) => spec)
    .filter((s) => s.startsWith('.') || s.startsWith('/'));
}

/**
 * The file a specifier imported from `file` names, as a path from the dist root.
 * @param {string} file the importing file, from the dist root
 * @param {string} spec
 */
export function resolveImport(file, spec) {
  return spec.startsWith('/') ? spec.slice(1) : posix.join(dirname(file), spec);
}
