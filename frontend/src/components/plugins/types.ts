import type { PluginCapability, PluginExecution, PluginPermission, PluginScope } from '@flo-plugin-api';

export type CapabilityKind = PluginCapability['kind'];
export type { PluginScope };
export type TrustLevel = 'flo_builtin' | 'flo_verified' | 'partner_verified' | 'community';
export type ExecutionMode = PluginExecution;
export type OfflineMode = 'supported' | 'degraded' | 'not_supported';
export type CountryCode = string;
export type Permission = PluginPermission;
export type InstallationStatus = 'installed' | 'activated' | 'disabled' | 'uninstalled';
export type FeatureActivationStatus = 'inactive' | 'activating' | 'active' | 'deactivating' | 'deactivated';

export interface CapabilityDescriptor extends Omit<PluginCapability, 'description'> {
  label: string;
  description: string;
  activationStatus?: FeatureActivationStatus;
  requirementsMet?: boolean;
}

export interface CatalogListing {
  listingId: string;
  packageId: string;
  name: string;
  tagline: string;
  publisherName: string;
  trustLevel: TrustLevel;
  scope: PluginScope;
  countries: CountryCode[];
  version: string;
  floApiVersion: string;
  execution: ExecutionMode[];
  capabilities: CapabilityDescriptor[];
  permissions: Permission[];
  offlineMode: OfflineMode;
  supportUrl?: string;
  pricing?: string;
}

export interface Installation {
  id: string;
  packageId: string;
  packageVersion: string;
  listingId: string;
  status: InstallationStatus;
  installedAt: string;
  activatedAt: string | null;
  statusDetail?: string;
  lastSuccessAt?: string | null;
}
