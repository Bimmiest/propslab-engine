import { describe, it, expect } from 'vitest';
import { resolveImport, staticImports } from './entryGraph.mjs';

// The import reading that scripts/lib/mutationTargets.mjs uses to find what a
// changed test imports.
describe('staticImports', () => {
  it('reads the static forms a minifier writes', () => {
    const source =
      'import{a as b}from"./x.js";import"./side.js";export{c}from"./y.js";export*from"./z.js";import d from"./d.js";';
    expect(staticImports(source)).toEqual(['./x.js', './side.js', './y.js', './z.js', './d.js']);
  });

  it('does not follow a dynamic import(), which is the lazy path', () => {
    expect(staticImports('const m=()=>import("./lazy.js");import("./also-lazy.js")')).toEqual([]);
  });

  it('leaves out a package specifier, which is not a file of the build', () => {
    expect(staticImports('import React from"react";import{x}from"./local.js"')).toEqual(['./local.js']);
  });

  it('reads the spaced forms of unminified output too', () => {
    expect(staticImports("import { a, b } from './x.js';\nexport * from '../up.js';")).toEqual(['./x.js', '../up.js']);
  });
});

describe('resolveImport', () => {
  it('resolves against the importing file, from the dist root', () => {
    expect(resolveImport('assets/index-a1.js', './vendor-b2.js')).toBe('assets/vendor-b2.js');
    expect(resolveImport('assets/sub/x.js', '../y.js')).toBe('assets/y.js');
  });

  it('takes a leading slash as the dist root', () => {
    expect(resolveImport('assets/index-a1.js', '/assets/other.js')).toBe('assets/other.js');
  });
});
