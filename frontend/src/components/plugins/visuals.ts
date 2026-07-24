// Small presentational helpers shared between the catalog and detail
// dialog. Kept here so the same colour/pill definitions stay in
// sync — if the design tweaks payment-blue a shade, we change it
// once.

import type {
  CapabilityKind,
  InstallationStatus,
  OfflineMode,
  PluginScope,
  TrustLevel,
} from './types';

export const CAPABILITY_META: Record<
  CapabilityKind,
  { label: string; accent: string; ring: string; chip: string }
> = {
  payment: {
    label: 'Payments',
    accent: 'text-blue-700',
    ring: 'ring-blue-200',
    chip: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  fiscal: {
    label: 'Fiscal',
    accent: 'text-violet-700',
    ring: 'ring-violet-200',
    chip: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  tax: {
    label: 'Tax',
    accent: 'text-emerald-700',
    ring: 'ring-emerald-200',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  delivery: {
    label: 'Delivery',
    accent: 'text-amber-700',
    ring: 'ring-amber-200',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  admin: {
    label: 'Admin',
    accent: 'text-slate-700',
    ring: 'ring-slate-200',
    chip: 'bg-slate-50 text-slate-700 border-slate-200',
  },
};

export const TRUST_META: Record<TrustLevel, { label: string; classes: string }> = {
  flo_builtin: {
    label: 'Built-in',
    classes: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  flo_verified: {
    label: 'Flo verified',
    classes: 'bg-brand-light text-brand border-brand/20',
  },
  partner_verified: {
    label: 'Partner verified',
    classes: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  community: {
    label: 'Community',
    classes: 'bg-amber-50 text-amber-700 border-amber-200',
  },
};

export const SCOPE_META: Record<PluginScope, { label: string; description: string }> = {
  country: { label: 'Country', description: 'One country only.' },
  multi_country: { label: 'Multi-country', description: 'A declared list of countries.' },
  global: { label: 'Global', description: 'Not limited to a country.' },
};

export const OFFLINE_META: Record<OfflineMode, { label: string; classes: string }> = {
  supported: { label: 'Works offline', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  degraded: { label: 'Limited offline', classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  not_supported: { label: 'Needs network', classes: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export const STATUS_META: Record<InstallationStatus, { label: string; classes: string }> = {
  installed: { label: 'Installed', classes: 'bg-blue-50 text-blue-700 border-blue-200' },
  activated: { label: 'Active', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  disabled: { label: 'Disabled', classes: 'bg-slate-100 text-slate-500 border-slate-200' },
  uninstalled: { label: 'Available', classes: 'bg-slate-100 text-slate-700 border-slate-200' },
};

/** Human-readable country list for the card footer. */
export function formatCountryList(countries: string[], emptyFallback: string): string {
  if (countries.length === 0) return emptyFallback;
  if (countries.length <= 3) return countries.join(' · ');
  return `${countries.slice(0, 3).join(' · ')} +${countries.length - 3}`;
}