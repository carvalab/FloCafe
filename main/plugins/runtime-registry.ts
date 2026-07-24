/**
 * Runtime registry — the only seam between the order/bill pipeline and
 * the in-process plugin runtimes.
 *
 * Stage 1: the AR, IN, TH, and global default tax engines are runnable
 * in-process. The registry holds references to those functions and
 * refuses to return a runtime for `hosted` capabilities.
 * Activation-aware: the tax dispatcher must not switch country math on
 * unless the package is installed AND activated for the store country.
 *
 * Resolution order for tax:
 *
 *  1. Activated country-specific package whose `countries` list
 *     includes the store country (e.g. `country.ar`, `country.in`, or
 *     `country.th`). Wins by design — country math differs from the default.
 *  2. Activated global default (`global.default`) — applies to every
 *     country that is not specifically handled.
 *
 * `getTaxEngineForCountry` is activation-aware. If the matching package
 * is installed but not `activated`, the dispatcher returns undefined and
 * falls back to the next candidate. If no candidate is active the
 * dispatcher returns undefined and the core path returns the
 * no-tax result for `product.tax_type === 'none'` only.
 */

import { AR_RUNTIME_BUNDLE } from './ar/runtime';
import { GLOBAL_DEFAULT_RUNTIME_BUNDLE } from './global/runtime';
import { PluginRegistry, type PluginRuntimeBundle, type TaxEngine } from './api-types';
import { PluginRuntimeKind } from './api-types';
import { IN_RUNTIME_BUNDLE } from './in/runtime';
import { TH_RUNTIME_BUNDLE } from './th/runtime';
import { findInstallationByPackageId, getFeature } from './installations';

const bundles: PluginRuntimeBundle[] = [
  AR_RUNTIME_BUNDLE,
  IN_RUNTIME_BUNDLE,
  TH_RUNTIME_BUNDLE,
  GLOBAL_DEFAULT_RUNTIME_BUNDLE,
];
const registry = new PluginRegistry();
for (const bundle of bundles) registry.register(bundle);

/**
 * Activation lookup that survives a not-yet-initialized database. The
 * plugin-contracts test (and a handful of others) import the tax
 * dispatcher before `initDatabase()` runs; the registry must answer
 * "no installation" with `false` rather than throw.
 */
function isActive(packageId: string, capabilityId: string): boolean {
  try {
    const installation = findInstallationByPackageId(packageId);
    if (installation?.status !== 'activated') return false;
    return getFeature(installation.id, capabilityId)?.status === 'active';
  } catch {
    return false;
  }
}

function findActiveCountryBundle(country: string): PluginRuntimeBundle | undefined {
  const upper = country.toUpperCase();
  return bundles.find((bundle) => {
    const manifest = bundle.manifest;
    if (manifest.scope !== 'country' && manifest.scope !== 'multi_country') return false;
    if (!manifest.countries.map((c) => c.toUpperCase()).includes(upper)) return false;
    const taxCapability = manifest.capabilities.find((capability) => capability.kind === 'tax' && capability.execution === 'in_process');
    return taxCapability ? isActive(manifest.id, taxCapability.id) : false;
  });
}

function findActiveGlobalBundle(): PluginRuntimeBundle | undefined {
  return bundles.find((bundle) => {
    const manifest = bundle.manifest;
    if (manifest.scope !== 'global') return false;
    const taxCapability = manifest.capabilities.find((capability) => capability.kind === 'tax' && capability.execution === 'in_process');
    return taxCapability ? isActive(manifest.id, taxCapability.id) : false;
  });
}

/**
 * Returns the in-process tax engine for the store country, or undefined
 * when no activated package covers it. Selection order:
 *
 *   1. Activated country-specific package matching the country.
 *   2. Activated global default package.
 *
 * A package installed but not `activated` is treated as inactive for
 * this lookup, so we never silently change math for a country whose
 * tax pack the operator has not enabled.
 */
export function getTaxEngineForCountry(country: string): TaxEngine | undefined {
  const countryBundle = findActiveCountryBundle(country);
  const bundle = countryBundle ?? findActiveGlobalBundle();
  if (!bundle) return undefined;
  const runtime = bundle.runtimes.find((item) => item.kind === PluginRuntimeKind.Tax);
  return runtime?.kind === PluginRuntimeKind.Tax ? runtime.connector : undefined;
}

export function getPluginRuntime(pluginId: string, capabilityId: string) {
  return registry.runtime(pluginId, capabilityId);
}
