/**
 * Delivery polling placeholder.
 *
 * Stage 1: configuration only. Real polling happens in the hosted
 * broker (Stage 3). This file describes what the merchant configures
 * (which providers to poll, polling interval) and validates the shape
 * before it lands in the connector_accounts table.
 *
 * Exports a `ConnectorConfigHandler` for every delivery provider in the
 * Stage 1 catalog so the route layer can dispatch by
 * `capability.provider` without branching on provider names.
 */

import { z } from 'zod';
import type { ConnectorAccount, ConnectorConfigHandler, PluginConfigField } from '../api-types';

export const DeliveryPollingConfigSchema = z.object({
  providers: z.array(z.object({
    provider: z.enum(['pedidosya', 'rappi', 'uber_eats', 'swiggy', 'zomato']),
    intervalSeconds: z.number().min(15).max(3600).default(30),
    enabled: z.boolean().default(true),
  })).superRefine((providers, context) => {
    const seen = new Set<string>();
    providers.forEach((provider, index) => {
      if (seen.has(provider.provider)) {
        context.addIssue({ code: 'custom', path: [index, 'provider'], message: `duplicates "${provider.provider}"` });
      }
      seen.add(provider.provider);
    });
  }),
});

export type DeliveryPollingProviderConfig = z.output<typeof DeliveryPollingConfigSchema>['providers'][number];
export type DeliveryPollingConfig = z.output<typeof DeliveryPollingConfigSchema>;

export const deliveryPollingConfigFields: PluginConfigField[] = [
  {
    name: 'intervalSeconds',
    kind: 'number',
    required: true,
    min: 15,
    max: 3600,
    step: 1,
    label: { en: 'Polling interval', es: 'Intervalo de consulta' },
    suffix: { en: 'seconds', es: 'segundos' },
  },
];

export interface DeliveryPollingValidation {
  valid: boolean;
  errors: string[];
  /** Resolved (normalized) config after applying defaults. */
  resolved: DeliveryPollingConfig;
}

export function validateDeliveryPollingConfig(
  raw: unknown,
): DeliveryPollingValidation {
  const parsed = DeliveryPollingConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`),
      resolved: { providers: [] },
    };
  }
  return { valid: true, errors: [], resolved: parsed.data };
}

/**
 * Returns the safe-to-expose delivery polling summary. No secrets,
 * no provider URLs — only the metadata the merchant needs to see at a
 * glance.
 */
export function summarizeDeliveryPolling(
  account: Pick<ConnectorAccount, 'providerAccountRef' | 'authStatus' | 'readiness' | 'lastHealthCheckAt'>,
  config: DeliveryPollingConfig,
): {
  providerAccountRef: string | null;
  authStatus: ConnectorAccount['authStatus'];
  readiness: ConnectorAccount['readiness'];
  lastHealthCheckAt: string | null;
  providers: Array<{ provider: string; intervalSeconds: number; enabled: boolean }>;
} {
  return {
    providerAccountRef: account.providerAccountRef,
    authStatus: account.authStatus,
    readiness: account.readiness,
    lastHealthCheckAt: account.lastHealthCheckAt,
    providers: config.providers.map((p) => ({
      provider: p.provider,
      intervalSeconds: p.intervalSeconds,
      enabled: p.enabled,
    })),
  };
}

/**
 * One handler per delivery provider. The capability→provider mapping is
 * declared in the manifest; the route dispatches to the handler whose
 * `provider` matches `capability.provider`, then `capabilityId` is just
 * for documentation/UI.
 */
function makeDeliveryHandler(provider: string, capabilityId: string): ConnectorConfigHandler {
  return {
    provider,
    capabilityId,
    fields: deliveryPollingConfigFields,
    validate(raw) {
      const rawConfig = (raw && typeof raw === 'object' && 'config' in (raw as Record<string, unknown>))
        ? (raw as { config: unknown }).config
        : raw;
      const candidate = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
        && !('providers' in (rawConfig as Record<string, unknown>))
        && 'intervalSeconds' in (rawConfig as Record<string, unknown>)
        ? { providers: [{ provider, ...(rawConfig as Record<string, unknown>) }] }
        : rawConfig;
      const result = validateDeliveryPollingConfig(candidate);
      return {
        valid: result.valid,
        errors: result.errors,
        resolved: result.resolved,
      };
    },
    summarize(account, resolvedConfig) {
      const config = resolvedConfig && typeof resolvedConfig === 'object'
        ? resolvedConfig as DeliveryPollingConfig
        : { providers: [] };
      return summarizeDeliveryPolling(account, config);
    },
  };
}

export const deliveryPollingHandlers: Record<string, ConnectorConfigHandler> = {
  pedidosya: makeDeliveryHandler('pedidosya', 'delivery.pedidosya'),
  rappi: makeDeliveryHandler('rappi', 'delivery.rappi'),
  uber_eats: makeDeliveryHandler('uber_eats', 'delivery.uber_eats'),
  swiggy: makeDeliveryHandler('swiggy', 'delivery.swiggy'),
  zomato: makeDeliveryHandler('zomato', 'delivery.zomato'),
};

export const allDeliveryProviders: readonly string[] = Object.keys(deliveryPollingHandlers);
