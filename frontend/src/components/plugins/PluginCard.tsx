'use client';

import {
  Boxes,
  CircleAlert,
  Download,
  PlugZap,
  Puzzle,
  Receipt,
  Settings2,
  ShieldCheck,
  Truck,
  Wallet,
} from 'lucide-react';
import type { CatalogListing, Installation, InstallationStatus } from './types';
import {
  CAPABILITY_META,
  formatCountryList,
  OFFLINE_META,
  SCOPE_META,
  STATUS_META,
  TRUST_META,
} from './visuals';

const CAPABILITY_ICON: Record<string, typeof Wallet> = {
  payment: Wallet,
  fiscal: Receipt,
  tax: Receipt,
  delivery: Truck,
  admin: Settings2,
};

interface PluginCardProps {
  listing: CatalogListing;
  installation: Installation | null;
  /** Country this store is configured for — used to grey out listings the store can't use. */
  storeCountry: string | null;
  onSelect: () => void;
}

/**
 * Single capability card. Renders capability pills, trust + offline
 * badges, status pill, and one of three actions:
 *
 * - `Install`  — listing not yet on this store
 * - `Activate` — package installed but not yet active (needs configuration)
 * - `View`     — already active; opens detail for health + permissions
 *
 * The buttons are distinct visually so the operator can never confuse
 * "the package is downloaded" with "the capability is enabled for
 * orders". This is the exact distinction the proposal requires.
 */
export function PluginCard({ listing, installation, storeCountry, onSelect }: PluginCardProps) {
  const status: InstallationStatus = installation?.status ?? 'uninstalled';
  const statusMeta = STATUS_META[status];
  const trustMeta = TRUST_META[listing.trustLevel];
  const offlineMeta = OFFLINE_META[listing.offlineMode];

  // Listings that aren't available in the current store country get a
  // dimmed treatment and no action — but they still render so the
  // operator knows the country pack exists and why it's locked.
  const availableInStore =
    listing.scope === 'global' ||
    (storeCountry !== null && listing.countries.includes(storeCountry));

  const primaryCapability = listing.capabilities[0];
  const CapabilityIcon = CAPABILITY_ICON[primaryCapability?.kind ?? 'admin'] ?? Puzzle;
  const accentMeta = CAPABILITY_META[primaryCapability?.kind ?? 'admin'];

  const action = pickAction(status, availableInStore);

  return (
    <article
      className={[
        'group relative flex flex-col rounded-xl border bg-white p-5 transition-all',
        'border-gray-100 hover:border-brand/30 hover:shadow-md focus-within:ring-2 focus-within:ring-brand/30',
        !availableInStore ? 'opacity-60' : '',
      ].join(' ')}
      aria-labelledby={`listing-${listing.listingId}-title`}
    >
      {/* Header row — capability icon + trust badge */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div
          className={[
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1',
            accentMeta.chip,
            accentMeta.ring,
          ].join(' ')}
          aria-hidden
        >
          <CapabilityIcon size={20} />
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${trustMeta.classes}`}
        >
          <ShieldCheck size={11} />
          {trustMeta.label}
        </span>
      </div>

      {/* Title + tagline */}
      <h3
        id={`listing-${listing.listingId}-title`}
        className="text-base font-semibold text-gray-900 leading-tight"
      >
        {listing.name}
      </h3>
      <p className="mt-1 text-sm text-gray-600 line-clamp-2 min-h-[2.5rem]">{listing.tagline}</p>

      {/* Capability chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {listing.capabilities.map((cap) => {
          const meta = CAPABILITY_META[cap.kind];
          return (
            <span
              key={cap.id}
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}
              title={cap.description}
            >
              {cap.label}
            </span>
          );
        })}
      </div>

      {/* Status pill */}
      <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${statusMeta.classes}`}
        >
          {statusMeta.label}
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${offlineMeta.classes}`}
        >
          {offlineMeta.label}
        </span>
      </div>

      {/* Detail footer — country + version + price */}
      <dl className="mt-4 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-gray-500 border-t border-gray-100 pt-3">
        <div>
          <dt className="uppercase tracking-wide font-medium">Scope</dt>
          <dd className="text-gray-700 mt-0.5">{SCOPE_META[listing.scope].label}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide font-medium">Version</dt>
          <dd className="text-gray-700 mt-0.5 font-mono">{listing.version}</dd>
        </div>
        <div className="col-span-2">
          <dt className="uppercase tracking-wide font-medium">Countries</dt>
          <dd className="text-gray-700 mt-0.5">
            {formatCountryList(listing.countries, 'Available worldwide')}
          </dd>
        </div>
      </dl>

      {installation?.statusDetail && (
        <p className="mt-3 text-[11px] text-gray-500 leading-snug bg-gray-50 rounded-md px-2 py-1.5">
          {installation.statusDetail}
        </p>
      )}

      {/* Action row */}
      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSelect}
          className="text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
        >
          Details
        </button>
        <ActionButton action={action} onSelect={onSelect} />
      </div>
    </article>
  );
}

type CardAction =
  | { kind: 'install'; label: string }
  | { kind: 'activate'; label: string }
  | { kind: 'view'; label: string }
  | { kind: 'unavailable'; label: string };

function pickAction(status: InstallationStatus, available: boolean): CardAction {
  if (!available) return { kind: 'unavailable', label: 'Not for your store' };
  switch (status) {
    case 'uninstalled':
      return { kind: 'install', label: 'Install' };
    case 'installed':
      return { kind: 'activate', label: 'Activate' };
    case 'activated':
    case 'disabled':
      return { kind: 'view', label: 'Manage' };
  }
}

function ActionButton({
  action,
  onSelect,
}: {
  action: CardAction;
  onSelect: () => void;
}) {
  if (action.kind === 'unavailable') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-500">
        <CircleAlert size={13} />
        {action.label}
      </span>
    );
  }

  const styleByKind = {
    install: 'bg-brand text-white hover:opacity-90',
    activate: 'bg-amber-500 text-white hover:bg-amber-600',
    view: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
  } as const;

  const Icon =
    action.kind === 'install' ? Download : action.kind === 'activate' ? PlugZap : Boxes;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${styleByKind[action.kind]}`}
    >
      <Icon size={13} />
      {action.label}
    </button>
  );
}