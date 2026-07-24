/**
 * Catalog layer — what the merchant-facing /api/plugins/catalog returns.
 *
 * Filtering rule (per docs/plugin-proposal.md): a listing is shown when
 * the store country matches the listing scope, OR the listing is global.
 * The catalog entry merges installation state and backend-owned readiness
 * requirements so the frontend does not reproduce activation rules.
 */

import { getSettingValue } from '../db';
import { getAllPackages, getPackageById } from './registry';
import {
  findInstallationByPackageId,
  listFeatures,
  listConnectorAccounts,
} from './installations';
import type {
  CatalogEntry,
  CatalogListing,
  InstallationFeature,
  PluginCapability,
  PluginCapabilityReadinessNeed,
  PluginManifest,
} from './api-types';

export function getStoreCountry(): string {
  return (getSettingValue('country') || '').toUpperCase();
}

export function isListingAvailableForCountry(manifest: PluginManifest, country: string): boolean {
  const c = (country || '').toUpperCase();
  if (!c) return false;
  if (manifest.scope === 'global') return true;
  return manifest.countries.map((x) => x.toUpperCase()).includes(c);
}

export function isCapabilityAvailableForCountry(
  capability: PluginCapability,
  manifest: PluginManifest,
  country: string,
): boolean {
  if (!capability.countries || capability.countries.length === 0) {
    return isListingAvailableForCountry(manifest, country);
  }
  return capability.countries.map((x) => x.toUpperCase()).includes((country || '').toUpperCase());
}

function buildListing(manifest: PluginManifest, country: string): CatalogListing {
  const capabilities = manifest.capabilities.filter((capability) => (
    isCapabilityAvailableForCountry(capability, manifest, country)
  ));
  return {
    listingId: `package.${manifest.id}`,
    packageId: manifest.id,
    packageVersion: manifest.version,
    publisher: manifest.publisher,
    name: manifest.displayName,
    description: manifest.description,
    scope: manifest.scope,
    countries: manifest.countries,
    capabilities,
    trustLevel: 'flo_builtin',
    execution: manifest.execution,
    providerAccountRequired: capabilities.some((c) => c.execution === 'hosted' && c.kind !== 'admin'),
    supportUrl: undefined,
    manifest,
  };
}

function capabilityRequirements(
  capability: PluginCapability,
  connectors: ReturnType<typeof listConnectorAccounts>,
): PluginCapabilityReadinessNeed[] {
  if (capability.execution !== 'hosted' || capability.kind === 'admin') return [];
  const account = connectors.find((connector) => connector.capabilityId === capability.id);
  if (!account) return ['connector_account'];
  const missing: PluginCapabilityReadinessNeed[] = [];
  if (account.authStatus !== 'authorized') missing.push('connector_authorization');
  if (account.readiness !== 'verified') {
    missing.push('connector_verification_hosted');
  }
  return missing;
}

function mergeFeatureRequirements(
  listing: CatalogListing,
  storedFeatures: InstallationFeature[],
  connectors: ReturnType<typeof listConnectorAccounts>,
): InstallationFeature[] {
  return listing.capabilities.map((capability) => {
    const stored = storedFeatures.find((feature) => feature.capabilityId === capability.id);
    const missingRequirements = capabilityRequirements(capability, connectors);
    return {
      installationId: stored?.installationId || null,
      capabilityId: capability.id,
      status: stored?.status || 'inactive',
      activatedAt: stored?.activatedAt || null,
      deactivatedAt: stored?.deactivatedAt || null,
      notes: stored?.notes || null,
      requirementsMet: missingRequirements.length === 0,
      missingRequirements,
    };
  });
}

export function getCatalog(country?: string): CatalogEntry[] {
  const effectiveCountry = (country || getStoreCountry()).toUpperCase();
  const pkgs = getAllPackages().filter((m) => isListingAvailableForCountry(m, effectiveCountry));
  return pkgs.map((m) => mergeWithInstallation(buildListing(m, effectiveCountry)));
}

export function getCatalogEntry(packageId: string, country?: string): CatalogEntry | null {
  const manifest = getPackageById(packageId);
  if (!manifest) return null;
  const effectiveCountry = (country || getStoreCountry()).toUpperCase();
  if (!isListingAvailableForCountry(manifest, effectiveCountry)) return null;
  return mergeWithInstallation(buildListing(manifest, effectiveCountry));
}

function mergeWithInstallation(listing: CatalogListing): CatalogEntry {
  const installation = findInstallationByPackageId(listing.packageId);
  if (!installation) {
    return { ...listing, installation: null, features: [], connectorAccounts: [] };
  }
  const connectorAccounts = listConnectorAccounts(installation.id);
  return {
    ...listing,
    installation,
    features: mergeFeatureRequirements(listing, listFeatures(installation.id), connectorAccounts),
    connectorAccounts,
  };
}
