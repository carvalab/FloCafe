'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, Boxes, CircleAlert, Filter, Globe, PlugZap, RefreshCw, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/hooks/useI18n';
import { PluginCard } from './PluginCard';
import { PluginDetailDialog } from './PluginDetailDialog';
import { fetchCatalog, fetchInstallations } from './data';
import type { CatalogListing, CapabilityKind, Installation } from './types';
import { CAPABILITY_META } from './visuals';

type CapabilityFilter = 'all' | CapabilityKind;

interface PluginCatalogProps {
  /** ISO country code (e.g. "AR") for the configured store country, or null if unset. */
  storeCountry: string | null;
}

/**
 * Catalog + installed rail. Country-filtered by design: the proposal
 * requires that country-scoped listings never appear for a store
 * outside their scope. Global listings always render.
 *
 * The catalog reads from a stubbed fetcher right now; the API will
 * replace it without changing this component.
 */
export function PluginCatalog({ storeCountry }: PluginCatalogProps) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<CatalogListing[] | null>(null);
  const [installations, setInstallations] = useState<Installation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [filter, setFilter] = useState<CapabilityFilter>('all');
  const [search, setSearch] = useState('');
  const [activeListing, setActiveListing] = useState<CatalogListing | null>(null);

  const load = async (opts: { manual?: boolean } = {}) => {
    if (opts.manual) setIsRefreshing(true);
    setError(null);
    try {
      const [c, i] = await Promise.all([fetchCatalog(storeCountry), fetchInstallations()]);
      setCatalog(c);
      setInstallations(i);
      setActiveListing((current) => {
        if (!current) return current;
        return c.find((listing) => listing.listingId === current.listingId) ?? current;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plugins.errorGeneric'));
    } finally {
      if (opts.manual) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // `load` is an event-like helper; country is the only reload trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeCountry]);

  // Index installations by listingId so the card lookup is O(1).
  const installationByListing = useMemo(() => {
    const map = new Map<string, Installation>();
    (installations ?? []).forEach((i) => map.set(i.listingId, i));
    return map;
  }, [installations]);

  const filteredListings = useMemo(() => {
    if (!catalog) return [];
    const term = search.trim().toLowerCase();
    return catalog.filter((l) => {
      if (filter !== 'all' && !l.capabilities.some((c) => c.kind === filter)) return false;
      if (!term) return true;
      const hay = [
        l.name,
        l.tagline,
        l.publisherName,
        ...l.capabilities.flatMap((c) => [c.label, c.description]),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(term);
    });
  }, [catalog, filter, search]);

  // Quick counts for the filter chips so the operator can see what's
  // available without clicking through.
  const counts = useMemo(() => {
    const out: Record<CapabilityFilter, number> = {
      all: 0,
      payment: 0,
      fiscal: 0,
      tax: 0,
      delivery: 0,
      admin: 0,
    };
    (catalog ?? []).forEach((l) => {
      const kinds = new Set(l.capabilities.map((c) => c.kind));
      kinds.forEach((k) => {
        out[k] = (out[k] ?? 0) + 1;
      });
      out.all += 1;
    });
    return out;
  }, [catalog]);

  const installedCount = (installations ?? []).length;
  const activeCount = (installations ?? []).filter((i) => i.status === 'activated').length;

  return (
    <section className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Boxes size={20} className="text-brand" />
            <h2 className="font-semibold text-gray-900">{t('plugins.title')}</h2>
          </div>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">{t('plugins.subtitle')}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load({ manual: true })}
          disabled={!catalog && !error}
          aria-label={t('plugins.refresh')}
        >
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          {t('plugins.refresh')}
        </Button>
      </header>

      {/* Status snapshot — quick "what's running" before the catalog */}
      {installations && (
        <div className="flex flex-wrap gap-2 text-xs">
          <SnapshotPill
            icon={<PlugZap size={12} />}
            label={t('plugins.snapshotInstalled', { count: installedCount })}
            tone="blue"
          />
          <SnapshotPill
            icon={<Activity size={12} />}
            label={t('plugins.snapshotActive', { count: activeCount })}
            tone="emerald"
          />
          <SnapshotPill
            icon={<Globe size={12} />}
            label={
              storeCountry
                ? t('plugins.snapshotCountry', { code: storeCountry })
                : t('plugins.snapshotCountryUnset')
            }
            tone="slate"
          />
        </div>
      )}

      {/* Filter + search row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap" role="tablist" aria-label={t('plugins.filterAriaLabel')}>
          <FilterChip
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            count={counts.all}
          >
            {t('plugins.filterAll')}
          </FilterChip>
          {(Object.keys(CAPABILITY_META) as CapabilityKind[]).map((kind) => {
            const meta = CAPABILITY_META[kind];
            return (
              <FilterChip
                key={kind}
                active={filter === kind}
                onClick={() => setFilter(kind)}
                count={counts[kind]}
              >
                {meta.label}
              </FilterChip>
            );
          })}
        </div>
        <div className="relative w-full sm:w-64">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('plugins.searchPlaceholder')}
            aria-label={t('plugins.searchAriaLabel')}
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none"
          />
        </div>
      </div>

      {/* Body — loading / error / empty / list */}
      {error ? (
        <ErrorState onRetry={() => load({ manual: true })} message={error} />
      ) : catalog === null ? (
        <LoadingGrid />
      ) : filteredListings.length === 0 ? (
        <EmptyState filter={filter} search={search} storeCountry={storeCountry} />
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {filteredListings.map((listing) => (
            <PluginCard
              key={listing.listingId}
              listing={listing}
              installation={installationByListing.get(listing.listingId) ?? null}
              storeCountry={storeCountry}
              onSelect={() => setActiveListing(listing)}
            />
          ))}
        </div>
      )}

      <PluginDetailDialog
        listing={activeListing}
        installation={activeListing ? installationByListing.get(activeListing.listingId) ?? null : null}
        storeCountryConfigured={storeCountry !== null}
        onOpenChange={(open) => {
          if (!open) setActiveListing(null);
        }}
        onChange={() => load({ manual: true })}
      />
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors border',
        active
          ? 'bg-brand text-white border-brand'
          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50',
      ].join(' ')}
    >
      <Filter size={11} aria-hidden />
      {children}
      {typeof count === 'number' && (
        <span
          className={[
            'inline-flex items-center justify-center rounded-full min-w-[18px] px-1 text-[10px] font-semibold',
            active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600',
          ].join(' ')}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function SnapshotPill({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone: 'blue' | 'emerald' | 'slate';
}) {
  const cls = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${cls}`}
    >
      {icon}
      {label}
    </span>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-gray-100 bg-white p-5 space-y-3"
          aria-hidden
        >
          <div className="flex items-start justify-between">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <Skeleton className="h-4 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <div className="flex gap-2">
            <Skeleton className="h-4 w-12 rounded-full" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <div className="pt-3 border-t border-gray-100 flex justify-between">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  filter,
  search,
  storeCountry,
}: {
  filter: CapabilityFilter;
  search: string;
  storeCountry: string | null;
}) {
  const { t } = useI18n();
  const filterLabel =
    filter === 'all' ? null : (CAPABILITY_META[filter]?.label.toLowerCase() ?? filter);

  let message: string;
  if (search.trim()) {
    message = t('plugins.emptySearch', { term: search.trim() });
  } else if (filterLabel) {
    message = t('plugins.emptyFiltered', { kind: filterLabel });
  } else if (!storeCountry) {
    message = t('plugins.emptyNoCountry');
  } else {
    message = t('plugins.emptyCountry', { code: storeCountry });
  }

  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6 rounded-xl border border-dashed border-gray-200 bg-gray-50/40">
      <div className="p-3 bg-white rounded-full shadow-sm mb-3">
        <Boxes className="w-6 h-6 text-gray-400" />
      </div>
      <p className="text-sm font-medium text-gray-900">{t('plugins.emptyTitle')}</p>
      <p className="text-xs text-gray-500 mt-1 max-w-md">{message}</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6 rounded-xl border border-rose-100 bg-rose-50/40">
      <div className="p-3 bg-white rounded-full shadow-sm mb-3">
        <CircleAlert className="w-6 h-6 text-rose-500" />
      </div>
      <p className="text-sm font-medium text-gray-900">{t('plugins.errorTitle')}</p>
      <p className="text-xs text-gray-600 mt-1 max-w-md">{message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        <RefreshCw size={13} />
        {t('plugins.errorRetry')}
      </Button>
    </div>
  );
}
