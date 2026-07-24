#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function fail(message) {
  console.error(`plugin:create: ${message}`);
  process.exit(1);
}

const name = option('--name');
const countries = option('--countries')?.split(',').map((country) => country.trim().toUpperCase()).filter(Boolean);
if (!name) fail('use --name "Mexico operations"');
if (!countries?.length || countries.some((country) => !/^[A-Z]{2}$/.test(country))) {
  fail('use --countries MX or --countries MX,GT');
}

const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
if (!slug) fail('name must contain at least one letter or number');

const packageId = `country.${slug}`;
const manifestName = `${slug.toUpperCase()}_MANIFEST`;
const packageDir = path.join(root, 'main', 'plugins', slug);
const registryPath = path.join(root, 'main', 'plugins', 'registry.ts');

if (fs.existsSync(packageDir)) fail(`package directory already exists: main/plugins/${slug}`);

const manifest = `import { PluginCapabilityKind, type PluginManifest } from '../api-types';

export const ${manifestName} = {
  manifestVersion: 1,
  id: '${packageId}',
  version: '1.0.0',
  publisher: { id: 'flo', name: 'Flo' },
  displayName: { en: '${name.replace(/'/g, "\\'")}' },
  scope: '${countries.length === 1 ? 'country' : 'multi_country'}',
  countries: ${JSON.stringify(countries)},
  floApiVersion: '^1.0.0',
  execution: ['in_process'],
  capabilities: [{
    id: 'admin.${slug}_settings',
    kind: PluginCapabilityKind.Admin,
    execution: 'in_process',
    operations: ['configure'],
    displayName: { en: '${name.replace(/'/g, "\\'")} settings' },
  }],
  permissions: ['settings.read'],
  artifact: { digest: 'built-in', signature: 'built-in' },
} satisfies PluginManifest;
`;

const packageReadme = `# ${name}

Generated Stage 1 plugin scaffold for ${countries.join(', ')}.

Replace the placeholder admin capability with the package's typed tax, payment,
fiscal, delivery, or admin contracts, then add contract and country-filter tests.
`;

const registry = fs.readFileSync(registryPath, 'utf8');
if (registry.includes(`from './${slug}/manifest'`)) fail(`package is already registered: ${packageId}`);

const importLine = `import { ${manifestName} } from './${slug}/manifest';`;
const importAnchor = "import type { PluginManifest } from './api-types';";
if (!registry.includes(importAnchor)) fail('registry import anchor changed; register the generated package manually');

const listMatch = registry.match(/const builtinManifests: PluginManifest\[\] = \[([\s\S]*?)\n\];/);
if (!listMatch) fail('registry manifest list changed; register the generated package manually');

const nextList = `const builtinManifests: PluginManifest[] = [${listMatch[1].trim()},\n  ${manifestName},\n];`;
const nextRegistry = registry
  .replace(importAnchor, `${importAnchor}\n${importLine}`)
  .replace(listMatch[0], nextList);

fs.mkdirSync(packageDir, { recursive: true });
fs.writeFileSync(path.join(packageDir, 'manifest.ts'), manifest);
fs.writeFileSync(path.join(packageDir, 'index.ts'), `export { ${manifestName} } from './manifest';\n`);
fs.writeFileSync(path.join(packageDir, 'README.md'), packageReadme);
fs.writeFileSync(registryPath, nextRegistry);

console.log(`Created ${packageId} in main/plugins/${slug}/`);
console.log('Next: replace the placeholder capability, add typed runtimes and tests, then run npm run build.');
