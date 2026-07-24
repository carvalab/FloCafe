'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  PlugZap,
  Power,
  Server,
  Settings2,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/hooks/useI18n';
import toast from 'react-hot-toast';
import type { CatalogListing, Installation, InstallationStatus } from './types';
import {
  activatePlugin,
  configureConnector,
  disablePlugin,
  formatApiError,
  installPlugin,
  setFeatureStatus,
  uninstallPlugin,
} from './data';
import {
  CAPABILITY_META,
  formatCountryList,
  OFFLINE_META,
  SCOPE_META,
  STATUS_META,
  TRUST_META,
} from './visuals';

interface PluginDetailDialogProps {
  listing: CatalogListing | null;
  installation: Installation | null;
  /** When false, the operator hasn't configured a store country yet. */
  storeCountryConfigured: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional callback invoked after a successful install / activate /
   * disable / uninstall so the parent can refetch catalog + installations
   * and refresh card statuses.
   */
  onChange?: () => void;
}

/**
 * Install / Activate / Manage dialog. Drives the two-step install
 * then activate flow with a permission preview the operator must
 * accept before install.
 *
 * Mutations hit `/api/plugins/installations[/:id/...]`; the parent
 * `PluginCatalog` refreshes itself on `onChange` so the card grid
 * picks up the new installation status.
 */
export function PluginDetailDialog({
  listing,
  installation,
  storeCountryConfigured,
  onOpenChange,
  onChange,
}: PluginDetailDialogProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<'review' | 'installing' | 'configure' | 'activating'>('review');
  const [acceptedPermissions, setAcceptedPermissions] = useState(false);
  const [featureBusy, setFeatureBusy] = useState<string | null>(null);
  const [connectorBusy, setConnectorBusy] = useState(false);
  const [configuration, setConfiguration] = useState<Record<string, string | number | boolean>>({});
  const [currentStatus, setCurrentStatus] = useState<InstallationStatus>(
    installation?.status ?? 'uninstalled',
  );

  // Reset local step state whenever a new listing is opened (or the
  // dialog closes). Keyed only on `listingId` — including the
  // installation status would let an in-flight mutation's optimistic
  // state get clobbered when the parent's refetch lands.
  useEffect(() => {
    setStep('review');
    setAcceptedPermissions(false);
    setFeatureBusy(null);
    setCurrentStatus(installation?.status ?? 'uninstalled');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.listingId]);

  if (!listing) return null;

  const statusMeta = STATUS_META[currentStatus];
  const trustMeta = TRUST_META[listing.trustLevel];
  const offlineMeta = OFFLINE_META[listing.offlineMode];

  const close = () => {
    onOpenChange(false);
  };

  const install = async () => {
    setStep('installing');
    try {
      const result = await installPlugin(listing);
      setCurrentStatus(result.status);
      setStep('configure');
      toast.success(t('plugins.toastInstalled', { name: listing.name }));
      onChange?.();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t('plugins.actionFailed')));
      setStep('review');
    }
  };

  const activate = async () => {
    setStep('activating');
    try {
      if (!installation) throw new Error('Plugin is not installed');
      const result = await activatePlugin(installation.id);
      setCurrentStatus(result.status);
      setStep('review');
      toast.success(t('plugins.toastActivated', { name: listing.name }));
      onChange?.();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t('plugins.actionFailed')));
      setStep('review');
    }
  };

  const disable = async () => {
    try {
      if (!installation) throw new Error('Plugin is not installed');
      const result = await disablePlugin(installation.id);
      setCurrentStatus(result.status);
      toast.success(t('plugins.toastDisabled', { name: listing.name }));
      onChange?.();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t('plugins.actionFailed')));
    }
  };

  const uninstall = async () => {
    try {
      if (!installation) throw new Error('Plugin is not installed');
      await uninstallPlugin(installation.id);
      setCurrentStatus('uninstalled');
      setStep('review');
      toast.success(t('plugins.toastUninstalled', { name: listing.name }));
      onChange?.();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t('plugins.actionFailed')));
    }
  };

  const toggleFeature = async (capabilityId: string, active: boolean) => {
    if (!installation) return;
    setFeatureBusy(capabilityId);
    try {
      await setFeatureStatus(installation.id, capabilityId, active ? 'deactivated' : 'active');
      toast.success(active ? t('plugins.toastFeatureDisabled') : t('plugins.toastFeatureActivated'));
      onChange?.();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t('plugins.actionFailed')));
    } finally {
      setFeatureBusy(null);
    }
  };

  const configureCapability = async (capabilityId: string) => {
    if (!installation) return;
    setConnectorBusy(true);
    try {
      await configureConnector(installation.id, capabilityId, configuration);
      toast.success(t('plugins.toastConnectorSaved'));
      onChange?.();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t('plugins.actionFailed')));
    } finally {
      setConnectorBusy(false);
    }
  };

  const countryLock = listing.scope !== 'global' && !storeCountryConfigured;

  return (
    <Dialog open={listing !== null} onOpenChange={(open) => (open ? null : close())}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-xl">{listing.name}</DialogTitle>
              <DialogDescription className="mt-1">{listing.tagline}</DialogDescription>
            </div>
            <span
              className={`inline-flex items-center gap-1 shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${trustMeta.classes}`}
            >
              <ShieldCheck size={12} />
              {trustMeta.label}
            </span>
          </div>
        </DialogHeader>

        <div className="space-y-5">
          {/* Status row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusMeta.classes}`}
            >
              {statusMeta.label}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${offlineMeta.classes}`}
            >
              {listing.offlineMode === 'not_supported' ? (
                <WifiOff size={12} />
              ) : (
                <Wifi size={12} />
              )}
              {offlineMeta.label}
            </span>
            {installation?.lastSuccessAt && currentStatus === 'activated' && (
              <span className="text-xs text-gray-500">
                {t('plugins.lastSuccess', { time: formatRelative(installation.lastSuccessAt) })}
              </span>
            )}
          </div>

          {/* Country lock warning */}
          {countryLock && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <CircleAlert size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                {t('plugins.countryLockHint')}
              </p>
            </div>
          )}

          {/* Installation detail */}
          {installation?.statusDetail && (
            <div className="flex items-start gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
              <CircleAlert size={16} className="text-gray-500 shrink-0 mt-0.5" />
              <p className="text-sm text-gray-700">{installation.statusDetail}</p>
            </div>
          )}

          {installation && listing.capabilities.filter((cap) => cap.configuration?.fields.length).map((cap) => (
            <CapabilityConfigurationForm
              key={cap.id}
              capability={cap}
              values={configuration}
              busy={connectorBusy}
              onChange={(name, value) => setConfiguration((current) => ({ ...current, [name]: value }))}
              onSubmit={() => configureCapability(cap.id)}
            />
          ))}

          {/* Capabilities */}
          <section>
            <h4 className="text-sm font-semibold text-gray-900 mb-2">
              {t('plugins.capabilitiesHeading')}
            </h4>
            <ul className="space-y-2">
              {listing.capabilities.map((cap) => {
                const meta = CAPABILITY_META[cap.kind];
                return (
                  <li
                    key={cap.id}
                    className="flex items-start gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2"
                  >
                    <span
                      className={`mt-0.5 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${meta.chip}`}
                    >
                      {meta.label}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{cap.label}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{cap.description}</p>
                      {installation && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[11px] text-gray-500">
                             {cap.activationStatus === 'active'
                               ? t('plugins.featureActive')
                               : cap.requirementsMet === false
                                 ? t('plugins.featureNeedsConfiguration')
                                 : t('plugins.featureInactive')}
                          </span>
                          <button
                            type="button"
                            className="text-[11px] font-medium text-brand hover:underline disabled:opacity-50"
                            disabled={
                              featureBusy === cap.id ||
                              cap.requirementsMet === false ||
                              cap.activationStatus === 'activating' ||
                              cap.activationStatus === 'deactivating'
                            }
                            onClick={() => toggleFeature(cap.id, cap.activationStatus === 'active')}
                          >
                            {featureBusy === cap.id ||
                            cap.activationStatus === 'activating' ||
                            cap.activationStatus === 'deactivating'
                              ? t('plugins.featureUpdating')
                              : cap.activationStatus === 'active'
                                ? t('plugins.disableFeature')
                                : t('plugins.activateFeature')}
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Permissions — gate install behind explicit acceptance */}
          <section>
            <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
              <KeyRound size={14} className="text-gray-500" />
              {t('plugins.permissionsHeading')}
            </h4>
            <ul className="grid sm:grid-cols-2 gap-1.5">
              {listing.permissions.map((perm) => (
                <li
                  key={perm}
                  className="flex items-center gap-2 rounded-md bg-gray-50 px-2 py-1.5 font-mono text-[11px] text-gray-700"
                >
                  <Lock size={11} className="text-gray-400 shrink-0" />
                  {perm}
                </li>
              ))}
            </ul>

            {step === 'review' && currentStatus === 'uninstalled' && (
              <label className="mt-3 flex items-start gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-gray-300 text-brand focus:ring-brand"
                  checked={acceptedPermissions}
                  onChange={(e) => setAcceptedPermissions(e.target.checked)}
                />
                <span className="text-gray-700">
                  {t('plugins.acceptPermissions', { name: listing.name })}
                </span>
              </label>
            )}
          </section>

          {/* Metadata grid */}
          <section className="grid sm:grid-cols-2 gap-3 text-sm">
            <MetaRow
              icon={<Globe size={14} />}
              label={t('plugins.countriesLabel')}
              value={
                listing.countries.length === 0
                  ? t('plugins.countriesGlobal')
                  : formatCountryList(listing.countries, '—')
              }
            />
            <MetaRow
              icon={<Server size={14} />}
              label={t('plugins.runtimeLabel')}
              value={listing.execution.join(' + ')}
            />
            <MetaRow
              icon={<Settings2 size={14} />}
              label={t('plugins.scopeLabel')}
              value={SCOPE_META[listing.scope].label}
            />
            <MetaRow
              icon={<CheckCircle2 size={14} />}
              label={t('plugins.floApiLabel')}
              value={<span className="font-mono text-xs">{listing.floApiVersion}</span>}
            />
            {listing.pricing && (
              <MetaRow
                icon={<ShieldCheck size={14} />}
                label={t('plugins.pricingLabel')}
                value={listing.pricing}
              />
            )}
            {listing.supportUrl && (
              <MetaRow
                icon={<ExternalLink size={14} />}
                label={t('plugins.supportLabel')}
                value={
                  <a
                    href={listing.supportUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand hover:underline truncate"
                  >
                    {listing.supportUrl}
                  </a>
                }
              />
            )}
          </section>
        </div>

        {/* Footer actions depend on the state machine */}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={close}>
            {t('common.close')}
          </Button>

          {currentStatus === 'uninstalled' && (
            <Button
              onClick={install}
              disabled={!acceptedPermissions || countryLock || step === 'installing'}
            >
              {step === 'installing' ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {t('plugins.installing')}
                </>
              ) : (
                <>
                  <Download size={15} />
                  {t('plugins.install')}
                </>
              )}
            </Button>
          )}

          {(currentStatus === 'installed' || currentStatus === 'disabled') && (
            <Button onClick={activate} disabled={step === 'activating' || countryLock}>
              {step === 'activating' ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {t('plugins.activating')}
                </>
              ) : (
                <>
                  <PlugZap size={15} />
                  {t('plugins.activate')}
                </>
              )}
            </Button>
          )}

          {currentStatus === 'activated' && (
            <Button variant="outline" onClick={disable}>
              <Power size={15} />
              {t('plugins.disable')}
            </Button>
          )}

          {(currentStatus === 'installed' ||
            currentStatus === 'activated' ||
            currentStatus === 'disabled') && (
            <Button variant="outline" onClick={uninstall}>
              <Trash2 size={15} />
              {t('plugins.uninstall')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-100 px-3 py-2 bg-gray-50/50">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-medium text-gray-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm text-gray-900 truncate">{value}</div>
    </div>
  );
}

function localized(value?: { en: string; es?: string }): string {
  return value?.en || '';
}

function CapabilityConfigurationForm({
  capability,
  values,
  busy,
  onChange,
  onSubmit,
}: {
  capability: CatalogListing['capabilities'][number];
  values: Record<string, string | number | boolean>;
  busy: boolean;
  onChange: (name: string, value: string | number | boolean) => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  const fields = capability.configuration?.fields ?? [];
  return (
    <section className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 space-y-3">
      <h4 className="text-sm font-semibold text-gray-900">{localized(capability.displayName)}</h4>
      <div className="grid sm:grid-cols-2 gap-3">
        {fields.map((field) => (
          <label key={field.name} className="space-y-1 text-xs text-gray-600">
            <span>{localized(field.label)}{field.required ? ' *' : ''}</span>
            {field.kind === 'select' ? (
              <select value={String(values[field.name] ?? '')} onChange={(event) => onChange(field.name, event.target.value)} className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-2 outline-none focus:border-brand">
                <option value="">—</option>
                {field.options.map((option) => <option key={option.value} value={option.value}>{localized(option.label)}</option>)}
              </select>
            ) : field.kind === 'boolean' ? (
              <input type="checkbox" checked={Boolean(values[field.name])} onChange={(event) => onChange(field.name, event.target.checked)} className="rounded border-gray-300 text-brand focus:ring-brand" />
            ) : (
              <input type={field.kind} value={String(values[field.name] ?? '')} min={field.kind === 'number' ? field.min : undefined} max={field.kind === 'number' ? field.max : undefined} step={field.kind === 'number' ? field.step : undefined} placeholder={localized(field.kind === 'text' ? field.placeholder : undefined)} onChange={(event) => onChange(field.name, field.kind === 'number' ? Number(event.target.value) : event.target.value)} className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-2 outline-none focus:border-brand" />
            )}
          </label>
        ))}
      </div>
      <Button size="sm" variant="outline" onClick={onSubmit} disabled={busy}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Settings2 size={14} />}
        {t('plugins.saveConnectorSetup')}
      </Button>
    </section>
  );
}


function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
