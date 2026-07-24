/**
 * Manifest validation and semantic checks.
 *
 * Structural validation lives in `shared/plugin-api.ts::validateManifest`
 * so the frontend can run the same checks. This file adds the
 * backend-specific glue: the supported Flo API version constant, the
 * hand-rolled semver-range checker, and the cataloger helpers.
 *
 * ponytail: hand-rolled semver range parser. One operator set
 * (>=, >, <=, <, =, ^, ~), one range per field, no nested ranges. Covers the
 * case ("floApiVersion": ">=1.0.0 <2.0.0") without pulling in a dep.
 */

import type { PluginCapabilityKind, PluginManifest } from './api-types';
import { validateManifest as validateManifestShared } from './api-types';

export const SUPPORTED_FLO_API_VERSION = '1.0.0';

function fail(errors: { field: string; message: string }[], field: string, message: string): void {
  errors.push({ field, message });
}

type SemVer = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

type SemVerConstraint = { op: string; version: SemVer };

function parseSemVer(value: string): SemVer | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  };
}

function parseSemverRange(range: string): SemVerConstraint[] | null {
  const tokens = range.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const constraints: SemVerConstraint[] = [];
  for (const token of tokens) {
    const match = token.match(/^(>=|<=|>|<|=|~|\^)?(.+)$/);
    const version = match ? parseSemVer(match[2]) : null;
    if (!match || !version) return null;
    constraints.push({ op: match[1] || '=', version });
  }
  return constraints;
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] === b[i]) continue;
    const aNumber = /^\d+$/.test(a[i]);
    const bNumber = /^\d+$/.test(b[i]);
    if (aNumber && bNumber) return Number(a[i]) - Number(b[i]);
    if (aNumber) return -1;
    if (bNumber) return 1;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function cmp(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return comparePrerelease(a.prerelease, b.prerelease);
}

function satisfiesConstraint(version: SemVer, constraint: SemVerConstraint): boolean {
  const comparison = cmp(version, constraint.version);
  if (constraint.op === '>=') return comparison >= 0;
  if (constraint.op === '<=') return comparison <= 0;
  if (constraint.op === '>') return comparison > 0;
  if (constraint.op === '<') return comparison < 0;
  if (constraint.op === '=') return comparison === 0;
  const upper = constraint.op === '^'
    ? constraint.version.major > 0
      ? { major: constraint.version.major + 1, minor: 0, patch: 0, prerelease: [] }
      : constraint.version.minor > 0
        ? { major: 0, minor: constraint.version.minor + 1, patch: 0, prerelease: [] }
        : { major: 0, minor: 0, patch: constraint.version.patch + 1, prerelease: [] }
    : { major: constraint.version.major, minor: constraint.version.minor + 1, patch: 0, prerelease: [] };
  return comparison >= 0 && cmp(version, upper) < 0;
}

export function satisfiesSemverRange(version: string, range: string): boolean {
  const parsedVersion = parseSemVer(version);
  if (!parsedVersion) return false;
  return range.split(/\s*\|\|\s*/).some((alternative) => {
    const constraints = parseSemverRange(alternative);
    return constraints?.every((constraint) => satisfiesConstraint(parsedVersion, constraint)) ?? false;
  });
}

/**
 * Validates a plugin manifest. Returns errors keyed by field; UI can render
 * these directly. Never throws.
 */
export function validateManifest(raw: unknown) {
  const result = validateManifestShared(raw);
  if (!result.valid) return result;

  const errors: { field: string; message: string }[] = [];
  const m = raw as PluginManifest;

  if (!satisfiesSemverRange(SUPPORTED_FLO_API_VERSION, m.floApiVersion)) {
    fail(errors, 'floApiVersion', `not compatible with Flo API ${SUPPORTED_FLO_API_VERSION}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Checks whether a manifest declares an operation needed for a feature kind.
 * Used by the activation gate: tax plugins must declare `fiscal.calculate` (or
 * a country-specific equivalent), payment plugins must declare at least one of
 * `payment.initialize/status/refund`, etc. Stage 1 keeps this permissive —
 * any package with a `tax` capability is treated as the tax engine for its
 * country scope.
 */
export function manifestSupportsCapabilityKind(manifest: PluginManifest, kind: PluginCapabilityKind): boolean {
  return manifest.capabilities.some((c) => c.kind === kind);
}
