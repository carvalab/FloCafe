/**
 * In-memory registry of plugin packages shipped in the repo.
 *
 * Stage 1: the AR, IN, and `global.default` packages are wired. The
 * registry is hand-maintained — adding a new country means registering
 * its manifest here. Stage 2 adds the signed external catalog API; this
 * in-memory list stays as the seed/builtin list.
 *
 * `getAllPackages()` is the catalog source-of-truth. Country filtering
 * happens in `catalog.ts`.
 *
 * `global.default` ships as a `scope: 'global'` package so the catalog
 * surfaces it for every store country without needing AR/IN-style
 * country rows. The runtime registry only activates it when no
 * country-specific package is already active for the store.
 */

import { AR_MANIFEST } from './ar/manifest';
import { IN_MANIFEST } from './in/manifest';
import { GLOBAL_DEFAULT_MANIFEST } from './global/manifest';
import { TH_MANIFEST } from './th/manifest';
import type { PluginManifest } from './api-types';

const builtinManifests: PluginManifest[] = [
  AR_MANIFEST,
  IN_MANIFEST,
  TH_MANIFEST,
  GLOBAL_DEFAULT_MANIFEST,
];

export function getAllPackages(): PluginManifest[] {
  return builtinManifests;
}

export function getPackageById(id: string): PluginManifest | undefined {
  return builtinManifests.find((manifest) => manifest.id === id);
}

export function registerPackage(manifest: PluginManifest): void {
  const existing = builtinManifests.findIndex((item) => item.id === manifest.id);
  if (existing >= 0) builtinManifests[existing] = manifest;
  else builtinManifests.push(manifest);
}
