// ---------------------------------------------------------------------------
// packageExports.test.ts
// The subpaths that the `exports` map of package.json lets a consumer
// resolve. With an `exports` map, Node refuses each subpath that the map does
// not name, and propslab#940 reads the engine's version from
// `propslab-engine/package.json` (#25). A self-reference resolves the name of
// the package through the same map that a consumer gets.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

describe('the exports map', () => {
  it('resolves propslab-engine/package.json to the package.json of the package', () => {
    expect(require.resolve('propslab-engine/package.json')).toBe(root('package.json'));
  });

  it('gives the version of the package through that subpath', () => {
    const own = JSON.parse(readFileSync(root('package.json'), 'utf8')) as { version: string };
    const resolved = require('propslab-engine/package.json') as { version: string };
    expect(resolved.version).toBe(own.version);
  });
});
