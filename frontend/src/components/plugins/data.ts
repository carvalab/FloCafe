import api from '@/lib/api';
import type { CatalogEntry, Installation as BackendInstallation, PluginCapability } from '@flo-plugin-api';
import {
  PluginCatalogResponseSchema,
  PluginConnectorResponseSchema,
  PluginFeatureResponseSchema,
  PluginInstallationResponseSchema,
  PluginInstallationsResponseSchema,
  PluginUninstallResponseSchema,
} from '@flo-plugin-api';
import type {
  CapabilityDescriptor,
  CatalogListing,
  FeatureActivationStatus,
  Installation,
} from './types';

function localized(value?: { en: string; es?: string }): string {
  return value?.en || '';
}

function toCapability(
  capability: PluginCapability,
  feature?: {
    status: FeatureActivationStatus;
    requirementsMet?: boolean;
  },
): CapabilityDescriptor {
  return {
    ...capability,
    label: localized(capability.displayName),
    description: localized(capability.description) || localized(capability.displayName),
    activationStatus: feature?.status,
    requirementsMet: feature?.requirementsMet ?? true,
  };
}

function toListing(entry: CatalogEntry): CatalogListing {
  return {
    listingId: entry.listingId,
    packageId: entry.packageId,
    name: localized(entry.name),
    tagline: localized(entry.description) || localized(entry.name),
    publisherName: entry.publisher.name,
    trustLevel: entry.trustLevel,
    scope: entry.scope,
    countries: entry.countries,
    version: entry.packageVersion,
    floApiVersion: entry.manifest.floApiVersion,
    execution: entry.execution,
    capabilities: entry.capabilities.map((capability) => toCapability(
      capability,
      entry.features.find((feature) => feature.capabilityId === capability.id),
    )),
    permissions: entry.manifest.permissions,
    offlineMode: entry.execution.includes('hosted') ? 'degraded' : 'supported',
  };
}

function toInstallation(row: BackendInstallation | null, packageId: string): Installation | null {
  if (!row || row.status === 'uninstalled') return null;
  return {
    id: row.id,
    packageId: row.packageId,
    packageVersion: row.packageVersion,
    listingId: packageId,
    status: row.status,
    installedAt: row.installedAt,
    activatedAt: row.activatedAt,
    statusDetail: row.notes || undefined,
  };
}

export async function fetchCatalog(storeCountry: string | null): Promise<CatalogListing[]> {
  const { data } = await api.get('/plugins/catalog', { params: storeCountry ? { country: storeCountry } : undefined });
  const parsed = PluginCatalogResponseSchema.parse(data);
  return parsed.catalog.map(toListing);
}

export async function fetchInstallations(): Promise<Installation[]> {
  const { data } = await api.get('/plugins/installations');
  const parsed = PluginInstallationsResponseSchema.parse(data);
  return parsed.installations.flatMap((row) => {
    const installation = toInstallation(row, row.packageId);
    return installation ? [installation] : [];
  });
}

export async function installPlugin(listing: CatalogListing): Promise<Installation> {
  const { data } = await api.post('/plugins/installations', {
    packageId: listing.packageId,
    packageVersion: listing.version,
    permissionsAccepted: true,
  });
  const parsed = PluginInstallationResponseSchema.parse(data);
  const installation = toInstallation(parsed.installation, listing.packageId);
  if (!installation) throw new Error('Invalid install response');
  return installation;
}

export async function activatePlugin(installationId: string): Promise<Installation> {
  const { data } = await api.post(`/plugins/installations/${encodeURIComponent(installationId)}/activate`);
  const parsed = PluginInstallationResponseSchema.parse(data);
  const installation = toInstallation(parsed.installation, parsed.installation?.packageId || '');
  if (!installation) throw new Error('Invalid activate response');
  return installation;
}

export async function disablePlugin(installationId: string): Promise<Installation> {
  const { data } = await api.post(`/plugins/installations/${encodeURIComponent(installationId)}/deactivate`);
  const parsed = PluginInstallationResponseSchema.parse(data);
  const installation = toInstallation(parsed.installation, parsed.installation?.packageId || '');
  if (!installation) throw new Error('Invalid disable response');
  return installation;
}

export async function uninstallPlugin(installationId: string): Promise<void> {
  const { data } = await api.delete(`/plugins/installations/${encodeURIComponent(installationId)}`);
  PluginUninstallResponseSchema.parse(data);
}

export async function setFeatureStatus(
  installationId: string,
  capabilityId: string,
  status: 'active' | 'deactivated',
): Promise<void> {
  const { data } = await api.patch(
    `/plugins/installations/${encodeURIComponent(installationId)}/features/${encodeURIComponent(capabilityId)}`,
    { status },
  );
  PluginFeatureResponseSchema.parse(data);
}

export async function configureConnector(
  installationId: string,
  capabilityId: string,
  config: Record<string, string | number | boolean>,
): Promise<void> {
  const { data } = await api.put(
    `/plugins/installations/${encodeURIComponent(installationId)}/connectors/${encodeURIComponent(capabilityId)}`,
    config,
  );
  PluginConnectorResponseSchema.parse(data);
}

export function formatApiError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as { response?: { data?: { error?: string } }; message?: string };
    return e.response?.data?.error || e.message || fallback;
  }
  return fallback;
}
