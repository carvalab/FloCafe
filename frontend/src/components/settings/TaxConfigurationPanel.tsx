'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseDbTimestamp } from '@/lib/utils';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  History,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/hooks/useI18n';

type PackSummary = {
  id: string;
  publisher: string;
  country: string;
  jurisdiction: string;
  active_version_id: string | null;
  status: string;
  active_for_store: boolean;
  trust_status: string;
  override_count: number;
  versions: PackVersion[];
};

type PackVersion = {
  id: string;
  version: string;
  schema_version: number;
  effective_from: string;
  effective_to: string | null;
  published_at: string;
  status: string;
};

type TaxCategory = {
  category_id: string;
  label: string;
  default_behavior: string;
  definition: { description?: string; ruleIds?: string[] };
};

type TaxRule = {
  rule_id: string;
  label: string;
  calculation_type: string;
  rate: string | null;
  amount: string | null;
  applies_per: string;
  base_rule_ids: string[];
  definition: { categoryIds?: string[] };
};

type TaxOverride = {
  id: string;
  entity_type: OverrideEntityType;
  entity_id: string | null;
  entity_name: string | null;
  value: { categoryId: string };
  created_by_name: string | null;
  updated_at: string;
};

type OverrideEntityType = 'product' | 'addon' | 'packaging' | 'delivery' | 'service_charge';

type ManualConfigForm = {
  rate: string;
  inclusive: boolean;
  label: string;
};

type OverrideTarget = {
  id: string;
  name: string;
  tax_category_id: string | null;
};

type PackDetail = {
  pack: PackSummary;
  versions: PackVersion[];
  active_version: (PackVersion & {
    definition: {
      currency: string;
      // Present on every pack; the manual form reads these back so a saved
      // configuration reloads instead of coming up blank.
      inclusivePricingDefault?: boolean;
      registrationNumberLabel?: string;
      taxRounding: { method: string; scope: string; decimalPlaces: number };
      payableRounding: { method: string; increment: string };
    };
    validation: {
      valid: boolean;
      checks: Array<{ id: number; passed: boolean; message: string }>;
    };
  }) | null;
  categories: TaxCategory[];
  rules: TaxRule[];
  overrides: TaxOverride[];
  targets: { products: OverrideTarget[]; addons: OverrideTarget[] };
};

type AuditRow = {
  id: number;
  action: string;
  actor_name: string | null;
  actor_user_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

type Calculation = {
  taxableBase: string;
  taxAmount: string;
  payableTotal: string;
  lines: Array<{
    components: Array<{ ruleId: string; label: string; amount: string; rate?: string }>;
  }>;
};

const ENTITY_LABELS_KEY: Record<OverrideEntityType, string> = {
  product: 'settings.tax.entityProduct',
  addon: 'settings.tax.entityAddon',
  packaging: 'settings.tax.entityPackaging',
  delivery: 'settings.tax.entityDelivery',
  service_charge: 'settings.tax.entityServiceCharge',
};

const pluginRequestSettingKey = (country: string) => `tax_plugin_request:${country}`;

async function loadPluginRequestId(country: string): Promise<string | null> {
  try {
    const response = await api.get(`/settings/${pluginRequestSettingKey(country)}`);
    return response.data.setting?.value || null;
  } catch {
    return null;
  }
}
const CHARGE_TYPES: OverrideEntityType[] = ['packaging', 'delivery', 'service_charge'];

const ACTION_LABELS_KEY: Record<string, string> = {
  install_bundled_pack: 'settings.tax.actionInstallBundledPack',
  install_downloaded_pack: 'settings.tax.actionInstallDownloadedPack',
  activate_pack: 'settings.tax.actionActivatePack',
  rollback_pack: 'settings.tax.actionRollbackPack',
  create_override: 'settings.tax.actionCreateOverride',
  update_override: 'settings.tax.actionUpdateOverride',
  reset_override: 'settings.tax.actionResetOverride',
  remap_categories: 'settings.tax.actionRemapCategories',
};

function apiMessage(error: unknown, fallback: string): string {
  const candidate = error as { response?: { data?: { error?: string } } };
  return candidate.response?.data?.error || fallback;
}

function dateTime(value: string): string {
  // Backend timestamps are UTC space form — parse as UTC, not machine-local.
  const date = parseDbTimestamp(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function categoryIdOf(override: TaxOverride): string {
  return override.value?.categoryId || '';
}

function auditDescription(row: AuditRow, t: (key: string, params?: Record<string, string | number>) => string): string {
  const details = row.details || {};
  if (row.action === 'install_bundled_pack') return t('settings.tax.auditBundleInstall', { version: String(details.version || '') });
  if (row.action === 'install_downloaded_pack') return t('settings.tax.auditDownloadInstall', { version: String(details.version || '') });
  if (row.action === 'create_override') {
    return t('settings.tax.auditCreateOverride', {
      entityType: String(details.entityType || 'target'),
      entityId: String(details.entityId || t('settings.tax.merchantOverridesStoreWide')),
      categoryId: String(details.categoryId || ''),
    });
  }
  if (row.action === 'update_override') {
    const before = (details.before || {}) as Record<string, unknown>;
    const after = (details.after || {}) as Record<string, unknown>;
    return t('settings.tax.auditUpdateOverride', {
      entityType: String(after.entityType || before.entityType || 'target'),
      entityId: String(after.entityId || before.entityId || t('settings.tax.merchantOverridesStoreWide')),
      before: String(before.categoryId || ''),
      after: String(after.categoryId || ''),
    });
  }
  if (row.action === 'reset_override') {
    return t('settings.tax.auditResetOverride', {
      entityType: String(details.entityType || 'target'),
      entityId: String(details.entityId || t('settings.tax.merchantOverridesStoreWide')),
    });
  }
  if (row.action === 'activate_pack') {
    if (details.source === 'manual_config') {
      const manual = t('settings.tax.auditActivateManualConfig', {
        rate: String(details.rate || ''),
        inclusive: String(details.inclusive
          ? t('settings.tax.auditActivateManualConfigInclusive')
          : t('settings.tax.auditActivateManualConfigExclusive')),
      });
      // A replacement is the most consequential thing this action can do —
      // it must not be invisible in the history.
      return details.replacedPackId
        ? `${manual} ${t('settings.tax.auditActivateManualConfigReplaced', {
          pack: String(details.replacedPackId),
          dormant: Number(details.dormantOverrides || 0),
        })}`
        : manual;
    }
    return t('settings.tax.auditActivatePack', {
      previousVersionId: String(details.previousVersionId || t('settings.tax.toastPreviousVersionNone')),
    });
  }
  if (row.action === 'remap_categories') {
    const remapped = Array.isArray(details.remapped) ? details.remapped : [];
    return t('settings.tax.auditRemapCategories', {
      total: remapped.reduce((sum: number, entry: { count?: number }) => sum + Number(entry.count || 0), 0),
      categories: remapped.map((entry: { from?: string; to?: string }) => `${entry.from} → ${entry.to}`).join(', '),
    });
  }
  if (row.action === 'rollback_pack') {
    return t('settings.tax.auditRollbackPack', {
      previousVersionId: String(details.previousVersionId || t('settings.tax.toastPreviousVersionUnknown')),
    });
  }
  return '';
}

export function TaxConfigurationPanel({ isOwner }: { isOwner: boolean }) {
  const { t } = useI18n();
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [storeCountry, setStoreCountry] = useState('');
  const [selectedPackId, setSelectedPackId] = useState('');
  const [detail, setDetail] = useState<PackDetail | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedChecklist, setExpandedChecklist] = useState(false);
  const [editingOverrideId, setEditingOverrideId] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<OverrideEntityType>('product');
  const [entityId, setEntityId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [testCategoryId, setTestCategoryId] = useState('');
  const [testAmount, setTestAmount] = useState('100');
  const [testBehavior, setTestBehavior] = useState('country_default');
  const [calculation, setCalculation] = useState<Calculation | null>(null);
  const [enablingTaxes, setEnablingTaxes] = useState(false);
  const [countryPackUnavailable, setCountryPackUnavailable] = useState(false);
  const [taxesEnabled, setTaxesEnabled] = useState(false);
  const [pluginRequested, setPluginRequested] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  // null = untouched, so the form mirrors whatever manual pack is saved. Any
  // edit forks a draft; a successful save drops it back to null to re-sync.
  const [manualDraft, setManualDraft] = useState<ManualConfigForm | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);

  const loadList = useCallback(async () => {
    const [response, settingResponse] = await Promise.all([
      api.get('/tax-packs'),
      api.get('/settings/taxes_enabled'),
    ]);
    const nextPacks = response.data.packs as PackSummary[];
    setPacks(nextPacks);
    setStoreCountry(response.data.store_country);
    const requestId = await loadPluginRequestId(response.data.store_country);
    setPluginRequested(Boolean(requestId));
    setCountryPackUnavailable(Boolean(requestId));
    setTaxesEnabled(settingResponse.data.setting?.value === 'true');
    setSelectedPackId((current) => {
      if (current && nextPacks.some((pack) => pack.id === current)) return current;
      return nextPacks.find((pack) => pack.active_for_store)?.id || nextPacks[0]?.id || '';
    });
  }, []);

  const loadDetail = useCallback(async (packId: string) => {
    if (!packId) {
      setDetail(null);
      return;
    }
    const response = await api.get(`/tax-packs/${encodeURIComponent(packId)}`);
    const nextDetail = response.data as PackDetail;
    setDetail(nextDetail);
    setCategoryId((current) => current || nextDetail.categories[0]?.category_id || '');
    setTestCategoryId((current) => current || nextDetail.categories[0]?.category_id || '');
  }, []);

  const loadAudit = useCallback(async () => {
    const response = await api.get('/tax-packs/audit?limit=100');
    setAudit(response.data.audit);
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      await Promise.all([
        loadList(),
        loadAudit(),
        ...(selectedPackId ? [loadDetail(selectedPackId)] : []),
      ]);
    } catch (error) {
      toast.error(apiMessage(error, t('settings.tax.toastLoadError')));
    } finally {
      setLoading(false);
    }
  }, [loadAudit, loadDetail, loadList, selectedPackId, t]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.get('/tax-packs'), api.get('/tax-packs/audit?limit=100')])
      .then(async ([packResponse, auditResponse]) => {
        if (cancelled) return;
        const nextPacks = packResponse.data.packs as PackSummary[];
        setPacks(nextPacks);
        setStoreCountry(packResponse.data.store_country);
        const requestId = await loadPluginRequestId(packResponse.data.store_country);
        if (cancelled) return;
        setPluginRequested(Boolean(requestId));
        setCountryPackUnavailable(Boolean(requestId));
        void api.get('/settings/taxes_enabled').then((settingResponse) => {
          setTaxesEnabled(settingResponse.data.setting?.value === 'true');
        }).catch(() => {});
        setSelectedPackId(
          nextPacks.find((pack) => pack.active_for_store)?.id || nextPacks[0]?.id || '',
        );
        setAudit(auditResponse.data.audit);
      })
      .catch((error) => {
        if (!cancelled) toast.error(apiMessage(error, t('settings.tax.toastLoadError')));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // t is stable per language (useI18n memoizes it), so this only re-runs
    // when the user switches language — the refetch is cheap and keeps the
    // error toasts in the new language.
  }, [t]);

  useEffect(() => {
    if (!selectedPackId) return;
    let cancelled = false;
    void api.get(`/tax-packs/${encodeURIComponent(selectedPackId)}`)
      .then((response) => {
        if (cancelled) return;
        const nextDetail = response.data as PackDetail;
        setDetail(nextDetail);
        setCategoryId(nextDetail.categories[0]?.category_id || '');
        setTestCategoryId(nextDetail.categories[0]?.category_id || '');
        setCalculation(null);
      })
      .catch((error) => {
        if (!cancelled) toast.error(apiMessage(error, t('settings.tax.toastLoadDetailError')));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedPackId, t]);

  const selectedPack = packs.find((pack) => pack.id === selectedPackId);
  // A saved manual pack has to come back into the form on reload. Blank fields
  // would read as "nothing configured" and a re-save from that state would
  // silently overwrite the owner's rate. The country check excludes the
  // bundled 'local-generic' pack, which is also publisher='local' but carries
  // country='*' and no rules — prefilling from it would junk the form.
  // The bundled no-tax pack is publisher='local' too, so that alone can't tell
  // a saved manual config apart from a pristine install. A configured manual
  // pack always carries a rate; the bundled one has rules: []. That's the whole
  // test — no country matching needed.
  const savedRate = detail?.pack.publisher === 'local'
    ? (detail.rules.find((rule) => rule.rate)?.rate || '')
    : '';
  const savedDefinition = detail?.active_version?.definition;
  const manualSaved: ManualConfigForm = savedRate
    ? {
      rate: savedRate,
      inclusive: savedDefinition?.inclusivePricingDefault !== false,
      label: savedDefinition?.registrationNumberLabel || '',
    }
    : { rate: '', inclusive: true, label: '' };
  const manualForm = manualDraft ?? manualSaved;

  // active_for_store is only ever true for the store country or the '*'
  // fallback, and '*' is publisher='local' — so the publisher test alone
  // identifies a verified country pack.
  const activeCountryPack = packs.find((pack) => pack.active_for_store);
  const officialPackActive = Boolean(activeCountryPack && activeCountryPack.publisher !== 'local');
  // Worked example on a round 100 so the inclusive/exclusive split is concrete:
  // inclusive extracts tax out of the price (100 stays 100), exclusive adds it
  // on top (100 becomes 100 + rate). Only shown once a usable rate is typed.
  const pricingExample = (() => {
    const rate = Number(manualForm.rate);
    if (!manualForm.rate || isNaN(rate) || rate <= 0 || rate > 100) return '';
    return manualForm.inclusive
      ? t('settings.tax.pricingExampleInclusive', {
        rate: manualForm.rate,
        tax: ((100 * rate) / (100 + rate)).toFixed(2),
      })
      : t('settings.tax.pricingExampleExclusive', {
        rate: manualForm.rate,
        tax: rate.toFixed(2),
        total: (100 + rate).toFixed(2),
      });
  })();
  const targetOptions = entityType === 'product'
    ? detail?.targets.products || []
    : entityType === 'addon'
      ? detail?.targets.addons || []
      : [];
  const needsEntity = entityType === 'product' || entityType === 'addon';
  const categoriesById = useMemo(
    () => new Map((detail?.categories || []).map((category) => [category.category_id, category.label])),
    [detail?.categories],
  );

  function resetOverrideForm() {
    setEditingOverrideId(null);
    setEntityType('product');
    setEntityId('');
    setCategoryId(detail?.categories[0]?.category_id || '');
  }

  function editOverride(override: TaxOverride) {
    setEditingOverrideId(override.id);
    setEntityType(override.entity_type);
    setEntityId(override.entity_id || '');
    setCategoryId(categoryIdOf(override));
  }

  async function saveOverride() {
    if (!isOwner) return;
    if (!categoryId || (needsEntity && !entityId)) {
      toast.error(t('settings.tax.toastOverrideTargetRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        entity_type: entityType,
        entity_id: needsEntity ? entityId : null,
        category_id: categoryId,
      };
      if (editingOverrideId) {
        await api.put(`/tax-packs/overrides/${editingOverrideId}`, payload);
        toast.success(t('settings.tax.toastOverrideUpdated'));
      } else {
        await api.post('/tax-packs/overrides', payload);
        toast.success(t('settings.tax.toastOverrideAdded'));
      }
      resetOverrideForm();
      await Promise.all([loadDetail(selectedPackId), loadList(), loadAudit()]);
    } catch (error) {
      toast.error(apiMessage(error, t('settings.tax.toastOverrideSaveError')));
    } finally {
      setSaving(false);
    }
  }

  async function removeOverride(override: TaxOverride) {
    if (!isOwner || !window.confirm(`Remove the override for ${override.entity_name || t(ENTITY_LABELS_KEY[override.entity_type])}?`)) return;
    setSaving(true);
    try {
      await api.delete(`/tax-packs/overrides/${override.id}`);
      toast.success(t('settings.tax.toastOverrideRemoved'));
      if (editingOverrideId === override.id) resetOverrideForm();
      await Promise.all([loadDetail(selectedPackId), loadList(), loadAudit()]);
    } catch (error) {
      toast.error(apiMessage(error, t('settings.tax.toastOverrideRemoveError')));
    } finally {
      setSaving(false);
    }
  }

  async function setChargeCategory(entityType: OverrideEntityType, nextCategoryId: string) {
    if (!isOwner || !selectedPack?.active_for_store || !CHARGE_TYPES.includes(entityType)) return;
    const current = detail?.overrides.find(
      (override) => override.entity_type === entityType && override.entity_id === null,
    );
    setSaving(true);
    try {
      if (!nextCategoryId) {
        if (current) await api.delete(`/tax-packs/overrides/${current.id}`);
        toast.success(t(entityType === 'packaging' ? 'settings.tax.toastPackagingRestored' : entityType === 'delivery' ? 'settings.tax.toastDeliveryRestored' : 'settings.tax.toastServiceRestored'));
      } else {
        const payload = {
          entity_type: entityType,
          entity_id: null,
          category_id: nextCategoryId,
        };
        if (current) {
          await api.put(`/tax-packs/overrides/${current.id}`, payload);
        } else {
          await api.post('/tax-packs/overrides', payload);
        }
        toast.success(t(entityType === 'packaging' ? 'settings.tax.toastPackagingCategorySaved' : entityType === 'delivery' ? 'settings.tax.toastDeliveryCategorySaved' : 'settings.tax.toastServiceCategorySaved'));
      }
      await Promise.all([loadDetail(selectedPackId), loadList(), loadAudit()]);
    } catch (error) {
      toast.error(apiMessage(error, t('settings.tax.toastChargeCategorySaveError')));
    } finally {
      setSaving(false);
    }
  }


  async function enableCountryTaxes() {
    if (!isOwner || !storeCountry) return;
    setEnablingTaxes(true);
    setCountryPackUnavailable(false);
    try {
      await api.post('/tax-packs/ensure-country', { country: storeCountry });
      setTaxesEnabled(true);
      setCountryPackUnavailable(false);
      setPluginRequested(false);
      await Promise.all([loadList(), loadAudit()]);
      toast.success(t('settings.tax.toastEnabledFor', { country: storeCountry }));
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        setCountryPackUnavailable(true);
        const key = pluginRequestSettingKey(storeCountry);
        const existing = await loadPluginRequestId(storeCountry);
        const clientTicketId = existing || crypto.randomUUID();
        if (!existing) await api.put(`/settings/${key}`, { value: clientTicketId });
        try {
          await api.post('/support-ticket', {
            client_ticket_id: clientTicketId,
            subject: t('settings.tax.supportTicketSubject', { country: storeCountry }),
            event_code: 'tax.country_plugin_unavailable',
            message: t('settings.tax.supportTicketMessage', { country: storeCountry }),
            diagnostics: { country: storeCountry },
          });
          setPluginRequested(true);
        } catch {
          // The visible unavailable state remains; the support outbox will retry
          // when the network is available on a later attempt.
        }
        return;
      }
      toast.error(apiMessage(error, t('settings.tax.toastEnableError')));
    } finally {
      setEnablingTaxes(false);
    }
  }

  async function submitManualConfig() {
    if (!isOwner || !storeCountry) return;
    const rateNum = Number(manualForm.rate);
    if (!manualForm.rate || isNaN(rateNum) || rateNum < 0 || rateNum > 100) {
      toast.error(t('settings.tax.toastRateRange'));
      return;
    }
    if (officialPackActive && !window.confirm(
      t('settings.tax.manualConfigReplaceConfirm', { pack: activeCountryPack?.id || '' }),
    )) {
      return;
    }
    setManualSubmitting(true);
    try {
      const response = await api.post('/tax-packs/manual-config', {
        rate: manualForm.rate,
        inclusive: manualForm.inclusive,
        label: manualForm.label.trim() || undefined,
        // Replacing a verified pack is confirmed above, never implicit.
        override: officialPackActive,
      });
      setTaxesEnabled(true);
      setCountryPackUnavailable(false);
      setPluginRequested(false);
      setSelectedPackId(response.data?.pack_id || '');
      // loadDetail explicitly: on a re-save selectedPackId does not change, so
      // the selectedPackId effect would not refetch and the panel (and the
      // form it feeds) would keep showing the superseded version.
      await Promise.all([
        loadList(),
        loadAudit(),
        ...(response.data?.pack_id ? [loadDetail(response.data.pack_id)] : []),
      ]);
      // Drop the draft so the form tracks the freshly saved pack again.
      setManualDraft(null);
      const validation = response.data?.validation;
      const passed = validation && Array.isArray(validation.checks)
        ? validation.checks.filter((check: { passed: boolean }) => check.passed).length
        : 0;
      const total = validation && Array.isArray(validation.checks) ? validation.checks.length : 24;
      toast.success(t('settings.tax.toastManualSaved', { passed, total }));
      // What the save cost: assignments the new pack could not keep, and
      // overrides that stopped applying. Never let these pass unannounced.
      const remapped: Array<{ count?: number }> = response.data?.remapped || [];
      const remappedTotal = remapped.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
      const dormant = Number(response.data?.dormant_overrides || 0);
      if (remappedTotal || dormant) {
        toast(t('settings.tax.toastManualSavedChanges', { remapped: remappedTotal, dormant }), {
          icon: '⚠️',
          duration: 8000,
        });
      }
    } catch (error) {
      toast.error(apiMessage(error, t('settings.tax.toastManualSaveError')));
    } finally {
      setManualSubmitting(false);
    }
  }

  async function calculate() {
    if (!selectedPack?.active_for_store) {
      toast.error(t('settings.tax.toastPickActivePack'));
      return;
    }
    const amountNum = Number(testAmount);
    if (!testCategoryId || !testAmount || isNaN(amountNum) || amountNum <= 0) {
      toast.error(t('settings.tax.toastTestAmount'));
      return;
    }
    try {
      const response = await api.post('/tax-packs/test-calculation', {
        category_id: testCategoryId,
        amount: amountNum,
        tax_behavior: testBehavior,
      });
      setCalculation(response.data.calculation);
    } catch (error) {
      setCalculation(null);
      toast.error(apiMessage(error, t('settings.tax.toastCalcError')));
    }
  }

  if (loading && !detail) {
    return <div className="py-16 text-center text-sm text-gray-500">{t('settings.tax.loading')}</div>;
  }

  return (
    <div className="pb-6 max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{t('settings.tax.configTitle')}</h2>
          <p className="mt-1 text-sm text-gray-500">
            {t('settings.tax.configDescription')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setLoading(true);
              void refreshAll();
            }}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> {t('settings.tax.refreshButton')}
          </Button>
        </div>
      </div>

      {!isOwner && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Lock size={16} className="mt-0.5 shrink-0" />
          {t('settings.tax.managerReadOnlyNotice')}
        </div>
      )}

      {!taxesEnabled && (
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">{t('settings.tax.notEnabledTitle')}</h3>
              <p className="mt-1 text-sm text-gray-600">
                {t('settings.tax.notEnabledDescription', { country: storeCountry })}
              </p>
            </div>
            <Button
              onClick={() => void enableCountryTaxes()}
              disabled={!isOwner || enablingTaxes}
              title={!isOwner ? t('settings.tax.onlyOwnersCanEnable') : undefined}
              className="shrink-0"
            >
              <Download size={15} />
              {enablingTaxes ? t('settings.tax.enablingButton') : t('settings.tax.enableButton')}
            </Button>
          </div>
          {countryPackUnavailable && (
            <p role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t('settings.tax.unavailableMessage', { country: storeCountry })}
              {pluginRequested && t('settings.tax.unavailableQueued')}
            </p>
          )}
        </section>
      )}

      {taxesEnabled && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-gray-900">{t('settings.tax.taxesEnabledTitle')}</h3>
            <p className="mt-1 text-sm text-gray-600">
              {selectedPack?.trust_status === 'Local'
                ? t('settings.tax.taxesEnabledLocal', { country: storeCountry })
                : t('settings.tax.taxesEnabledOfficial', { country: storeCountry })}
            </p>
            {selectedPack?.trust_status && (
              <span className="mt-2 inline-flex items-center rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-xs font-medium text-emerald-800">
                {selectedPack.trust_status === 'Local'
                  ? t('settings.tax.trustStatusLocal')
                  : selectedPack.trust_status}
              </span>
            )}
          </div>
          <Button
            variant="outline"
            disabled={!isOwner || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api.put('/settings/taxes_enabled', { value: 'false' });
                setTaxesEnabled(false);
                toast.success(t('settings.tax.toastDisabled'));
              } catch (error) {
                toast.error(apiMessage(error, t('settings.tax.toastDisableError')));
              } finally {
                setSaving(false);
              }
            }}
          >
            {t('settings.tax.turnTaxesOff')}
          </Button>
        </section>
      )}

      {/* Always available: set a rate before any pack exists, or replace the
          active one when the official rates do not match the store. */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-sm font-medium text-gray-800">{t('settings.tax.manualConfigTitle')}</p>
        <p className="mt-1 text-xs text-gray-500">
          {t('settings.tax.manualConfigDescription', { country: storeCountry })}
        </p>
        {officialPackActive && (
          <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t('settings.tax.manualConfigReplaceWarning', { pack: activeCountryPack?.id || '' })}
          </p>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-700">{t('settings.tax.rateLabel')}</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.01"
              value={manualForm.rate}
              onChange={(event) => setManualDraft({ ...manualForm, rate: event.target.value })}
              disabled={!isOwner || manualSubmitting}
              placeholder={t('settings.tax.ratePlaceholder')}
              className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-100"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700">{t('settings.tax.pricingLabel')}</span>
            <select
              value={manualForm.inclusive ? 'inclusive' : 'exclusive'}
              onChange={(event) => setManualDraft({ ...manualForm, inclusive: event.target.value === 'inclusive' })}
              disabled={!isOwner || manualSubmitting}
              className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm disabled:bg-gray-100"
            >
              <option value="inclusive">{t('settings.tax.pricingInclusive')}</option>
              <option value="exclusive">{t('settings.tax.pricingExclusive')}</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700">{t('settings.tax.registrationLabel')}</span>
            <input
              value={manualForm.label}
              onChange={(event) => setManualDraft({ ...manualForm, label: event.target.value })}
              disabled={!isOwner || manualSubmitting}
              placeholder={t('settings.tax.registrationPlaceholder')}
              className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-100"
            />
            <span className="mt-1 block text-xs text-gray-500">{t('settings.tax.registrationHint')}</span>
          </label>
        </div>

        {/* "Inclusive" vs "exclusive" is the single most misread field here, so
            it gets a plain sentence plus a worked example at the entered rate. */}
        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <p className="text-xs font-medium text-gray-700">
            {manualForm.inclusive ? t('settings.tax.pricingHintInclusive') : t('settings.tax.pricingHintExclusive')}
          </p>
          {pricingExample && (
            <p className="mt-1 text-xs text-gray-500">{pricingExample}</p>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => void submitManualConfig()}
            disabled={!isOwner || manualSubmitting}
            title={!isOwner ? t('settings.tax.onlyOwnersCanChange') : undefined}
            className="w-full whitespace-normal sm:w-auto"
          >
            {manualSubmitting
              ? t('settings.tax.savingManualConfig')
              : officialPackActive
                ? t('settings.tax.replaceWithManualConfig')
                : t('settings.tax.saveManualConfig')}
          </Button>
        </div>
      </section>

      <button
        type="button"
        onClick={() => setShowAdvancedTools((value) => !value)}
        className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-5 text-left"
      >
        <div>
          <h3 className="font-semibold text-gray-900">{t('settings.tax.advancedToolsTitle')}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {t('settings.tax.advancedToolsDescription')}
          </p>
        </div>
        <ChevronDown size={18} className={`shrink-0 text-gray-500 ${showAdvancedTools ? 'rotate-180' : ''}`} />
      </button>

      {showAdvancedTools && (
        <>
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-brand" />
            <h3 className="font-semibold text-gray-900">{t('settings.tax.installedPacksTitle')}</h3>
          </div>
          <span className="text-xs text-gray-500">{t('settings.tax.installedPacksDescription', { country: storeCountry })}</span>
        </div>

        {selectedPack && detail ? (
          <>
            {detail.active_version ? (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Info label="Store country" value={storeCountry} />
                  <Info label="Jurisdiction" value={selectedPack.jurisdiction} />
                  <Info label="Active version" value={detail.active_version.version} />
                  <Info label="Trust status" value={detail.pack.trust_status} />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                  <span>Effective {detail.active_version.effective_from}</span>
                  <span>Published {detail.active_version.published_at}</span>
                  <span>{detail.active_version.definition.currency}</span>
                  <button
                    type="button"
                    onClick={() => setExpandedChecklist((value) => !value)}
                    className="ml-auto flex items-center gap-1 font-medium text-brand"
                  >
                    {detail.active_version.validation.valid ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    {detail.active_version.validation.valid
                      ? t('settings.tax.testCalcActivationChecksPassed', {
                          passed: detail.active_version.validation.checks.filter((c) => c.passed).length,
                          total: detail.active_version.validation.checks.length,
                        })
                      : t('settings.tax.testCalcActivationChecksFailed')}
                    <ChevronDown size={14} className={expandedChecklist ? 'rotate-180' : ''} />
                  </button>
                </div>
                {expandedChecklist && (
                  <ol className="mt-3 grid gap-1 rounded-lg border border-gray-100 p-3 text-xs sm:grid-cols-2">
                    {detail.active_version.validation.checks.map((check) => (
                      <li key={check.id} className={check.passed ? 'text-gray-600' : 'text-red-700'}>
                        {check.passed ? '✓' : '✕'} {check.id}. {check.message}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : (
              <p className="mt-4 text-sm text-gray-500">
                {t('settings.tax.noActiveVersion')}
              </p>
            )}
            <div className="mt-5 border-t border-gray-100 pt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-gray-800">{t('settings.tax.installedVersions')}</p>
              </div>
              <div className="space-y-2">
                {detail.versions.map((version) => {
                  const active = version.id === detail.pack.active_version_id;
                  return (
                    <div key={version.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
                      <span>
                        v{version.version}
                        <span className="ml-2 text-xs text-gray-400">{version.status}</span>
                      </span>
                      {active && <span className="text-xs font-medium text-emerald-700">{t('settings.tax.activeBadge')}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-gray-500">No active installed pack is available.</p>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Calculator size={20} className="text-brand" />
          <h3 className="font-semibold text-gray-900">{t('settings.tax.testCalcTitle')}</h3>
        </div>
        <p className="mt-1 text-sm text-gray-500">{t('settings.tax.testCalcDescription')}</p>
        {!selectedPack?.active_for_store && (
          <p className="mt-2 text-xs text-amber-700">{t('settings.tax.testCalcInactivePack')}</p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <select disabled={!selectedPack?.active_for_store} value={testCategoryId} onChange={(event) => setTestCategoryId(event.target.value)} className="rounded-md border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-100">
            {detail?.categories.map((category) => <option key={category.category_id} value={category.category_id}>{category.label}</option>)}
          </select>
          <input
            value={testAmount}
            onChange={(event) => setTestAmount(event.target.value)}
            inputMode="decimal"
            placeholder={t('settings.tax.testCalcAmountPlaceholder')}
            disabled={!selectedPack?.active_for_store}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-100"
          />
          <select disabled={!selectedPack?.active_for_store} value={testBehavior} onChange={(event) => setTestBehavior(event.target.value)} className="rounded-md border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-100">
            <option value="country_default">{t('settings.tax.testCalcBehaviorCountryDefault')}</option>
            <option value="exclusive">{t('settings.tax.testCalcBehaviorExclusive')}</option>
            <option value="inclusive">{t('settings.tax.testCalcBehaviorInclusive')}</option>
            <option value="exempt">{t('settings.tax.testCalcBehaviorExempt')}</option>
          </select>
          <Button disabled={!selectedPack?.active_for_store} onClick={() => void calculate()}>{t('settings.tax.testCalcButton')}</Button>
        </div>
        {calculation && (
          <div className="mt-4 rounded-lg bg-gray-50 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Info label={t('settings.tax.testCalcTaxableBase')} value={calculation.taxableBase} />
              <Info label={t('settings.tax.testCalcTax')} value={calculation.taxAmount} />
              <Info label={t('settings.tax.testCalcPayableTotal')} value={calculation.payableTotal} />
            </div>
            {calculation.lines[0]?.components.length > 0 && (
              <div className="mt-3 border-t border-gray-200 pt-3 text-xs text-gray-600">
                {calculation.lines[0].components.map((component) => (
                  <div key={component.ruleId} className="flex justify-between py-0.5">
                    <span>{component.label}{component.rate ? ` · ${component.rate}%` : ''}</span>
                    <span>{component.amount}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={20} className="text-brand" />
          <h3 className="font-semibold text-gray-900">{t('settings.tax.chargeCategoriesTitle')}</h3>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {t('settings.tax.chargeCategoriesDescription')}
        </p>
        {!selectedPack?.active_for_store && (
          <p className="mt-2 text-xs text-amber-700">{t('settings.tax.testCalcInactivePack')}</p>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {CHARGE_TYPES.map((chargeType) => {
            const configured = detail?.overrides.find(
              (override) => override.entity_type === chargeType && override.entity_id === null,
            );
            return (
              <label key={chargeType} className="block">
                <span className="text-sm font-medium text-gray-800">{t(ENTITY_LABELS_KEY[chargeType])}</span>
                <select
                  value={configured ? categoryIdOf(configured) : ''}
                  onChange={(event) => void setChargeCategory(chargeType, event.target.value)}
                  disabled={!isOwner || saving || !selectedPack?.active_for_store}
                  className="mt-2 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm disabled:bg-gray-100"
                >
                  <option value="">{t('settings.tax.chargeNotConfigured')}</option>
                  {detail?.categories.map((category) => (
                    <option key={category.category_id} value={category.category_id}>{category.label}</option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={20} className="text-brand" />
          <h3 className="font-semibold text-gray-900">{t('settings.tax.merchantOverridesTitle')}</h3>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {t('settings.tax.merchantOverridesDescription')}
        </p>

        {isOwner && (
          <div className="mt-4 grid gap-3 rounded-lg border border-gray-100 bg-gray-50 p-4 sm:grid-cols-3">
            <select
              value={entityType}
              onChange={(event) => {
                setEntityType(event.target.value as OverrideEntityType);
                setEntityId('');
              }}
              className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              {(['product', 'addon'] as OverrideEntityType[]).map((value) => (
                <option key={value} value={value}>{t(ENTITY_LABELS_KEY[value])}</option>
              ))}
            </select>
            {needsEntity ? (
              <select value={entityId} onChange={(event) => setEntityId(event.target.value)} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                <option value="">{t('settings.tax.merchantOverridesChoose', { type: t(ENTITY_LABELS_KEY[entityType]).toLowerCase() })}</option>
                {targetOptions.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
              </select>
            ) : (
              <div className="rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-500">{t('settings.tax.merchantOverridesStoreWide')}</div>
            )}
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
              {detail?.categories.map((category) => <option key={category.category_id} value={category.category_id}>{category.label}</option>)}
            </select>
            <div className="flex gap-2 sm:col-span-3 sm:justify-end">
              {editingOverrideId && <Button variant="outline" onClick={resetOverrideForm}>{t('settings.tax.merchantOverridesCancel')}</Button>}
              <Button disabled={saving} onClick={() => void saveOverride()}>
                <Plus size={14} /> {editingOverrideId ? t('settings.tax.merchantOverridesSave') : t('settings.tax.merchantOverridesAdd')}
              </Button>
            </div>
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b border-gray-100 text-xs uppercase text-gray-400">
              <tr><th className="py-2 pr-3">{t('settings.tax.merchantOverridesTarget')}</th><th className="py-2 pr-3">{t('settings.tax.merchantOverridesCategory')}</th><th className="py-2 pr-3">{t('settings.tax.merchantOverridesUpdated')}</th><th className="py-2 text-right">{t('settings.tax.merchantOverridesActions')}</th></tr>
            </thead>
            <tbody>
              {detail?.overrides.map((override) => (
                <tr key={override.id} className="border-b border-gray-50">
                  <td className="py-3 pr-3"><span className="text-xs text-gray-400">{t(ENTITY_LABELS_KEY[override.entity_type])}</span><br />{override.entity_name || t('settings.tax.merchantOverridesStoreWide')}</td>
                  <td className="py-3 pr-3">{categoriesById.get(categoryIdOf(override)) || categoryIdOf(override)}</td>
                  <td className="py-3 pr-3 text-xs text-gray-500">{dateTime(override.updated_at)}{override.created_by_name ? ` · ${override.created_by_name}` : ''}</td>
                  <td className="py-3 text-right">
                    {isOwner ? (
                      <div className="flex justify-end gap-2">
                        {!CHARGE_TYPES.includes(override.entity_type) && (
                          <button className="text-brand hover:underline" onClick={() => editOverride(override)}>{t('settings.tax.merchantOverridesEdit')}</button>
                        )}
                        <button className="text-red-600 hover:underline" onClick={() => void removeOverride(override)}>{t('settings.tax.merchantOverridesRemove')}</button>
                      </div>
                    ) : <span className="text-xs text-gray-400">{t('settings.tax.merchantOverridesReadOnly')}</span>}
                  </td>
                </tr>
              ))}
              {!detail?.overrides.length && <tr><td colSpan={4} className="py-8 text-center text-gray-400">{t('settings.tax.merchantOverridesEmpty')}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="font-semibold text-gray-900">{t('settings.tax.packReferenceTitle')}</h3>
        <p className="mt-1 text-sm text-gray-500">{t('settings.tax.packReferenceDescription')}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-gray-100 text-xs uppercase text-gray-400">
              <tr><th className="py-2 pr-3">{t('settings.tax.merchantOverridesCategory')}</th><th className="py-2 pr-3">{t('settings.tax.packReferenceDefaultBehavior')}</th><th className="py-2">{t('settings.tax.packReferenceRules')}</th></tr>
            </thead>
            <tbody>
              {detail?.categories.map((category) => (
                <tr key={category.category_id} className="border-b border-gray-50">
                  <td className="py-3 pr-3"><span className="font-medium">{category.label}</span><br /><code className="text-xs text-gray-400">{category.category_id}</code></td>
                  <td className="py-3 pr-3">{category.default_behavior || t('settings.tax.packReferenceNone')}</td>
                  <td className="py-3 text-xs text-gray-600">{category.definition.ruleIds?.join(', ') || t('settings.tax.packReferenceNone')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-gray-100 text-xs uppercase text-gray-400">
              <tr><th className="py-2 pr-3">{t('settings.tax.packReferenceRules')}</th><th className="py-2 pr-3">{t('settings.tax.packReferenceType')}</th><th className="py-2 pr-3">{t('settings.tax.packReferenceValue')}</th><th className="py-2 pr-3">{t('settings.tax.packReferenceScope')}</th><th className="py-2">{t('settings.tax.packReferenceDependsOn')}</th></tr>
            </thead>
            <tbody>
              {detail?.rules.map((rule) => (
                <tr key={rule.rule_id} className="border-b border-gray-50">
                  <td className="py-3 pr-3"><span className="font-medium">{rule.label}</span><br /><code className="text-xs text-gray-400">{rule.rule_id}</code></td>
                  <td className="py-3 pr-3">{rule.calculation_type}</td>
                  <td className="py-3 pr-3">{rule.rate !== null ? `${rule.rate}%` : rule.amount}</td>
                  <td className="py-3 pr-3">{rule.applies_per}</td>
                  <td className="py-3 text-xs text-gray-600">{rule.base_rule_ids.join(', ') || t('settings.tax.packReferenceNone')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <History size={20} className="text-brand" />
          <h3 className="font-semibold text-gray-900">{t('settings.tax.auditHistoryTitle')}</h3>
        </div>
        <div className="mt-4 space-y-2">
          {audit.map((row) => (
            <div key={row.id} className="flex items-start gap-3 rounded-lg border border-gray-100 px-3 py-3">
              <Clock3 size={15} className="mt-0.5 shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800">{ACTION_LABELS_KEY[row.action] ? t(ACTION_LABELS_KEY[row.action]) : row.action}</p>
                {auditDescription(row, t) && <p className="truncate text-xs text-gray-600">{auditDescription(row, t)}</p>}
                <p className="text-xs text-gray-500">{row.actor_name || (row.actor_user_id ? t('settings.tax.auditActorUnknown') : t('settings.tax.auditActorSystem'))} · {dateTime(row.created_at)}</p>
              </div>
            </div>
          ))}
          {!audit.length && <p className="py-6 text-center text-sm text-gray-400">{t('settings.tax.auditHistoryEmpty')}</p>}
        </div>
      </section>
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-800">{value}</p>
    </div>
  );
}
