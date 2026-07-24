/**
 * Mercado Pago connector configuration.
 *
 * Stage 1: configuration only. No network calls. The connector
 * records what the merchant entered so the activation status endpoint
 * can tell the merchant "you haven't finished setup" instead of
 * pretending the provider is wired up.
 *
 * When the broker and hosted connector arrive in Stage 3, this file
 * becomes the in-repo reference for the configuration shape — the
 * hosted connector reads the same fields from `plugin_connector_accounts`.
 *
 * Exports a `ConnectorConfigHandler` for the `mercadopago` provider so
 * the route layer can route by `capability.provider` without knowing
 * anything about Mercado Pago's fields.
 */

import { z } from 'zod';
import type { ConnectorAccount, ConnectorConfigHandler, PluginConfigField } from '../api-types';

export const MercadoPagoAccountConfigSchema = z.object({
  /** Store ID (sucursal) Mercado Pago associates with this POS. */
  storeId: z.string().min(1).optional(),
  /** External cash-register ID configured in Mercado Pago for QR Orders. */
  externalPosId: z.string().min(1).optional(),
  /** QR Orders mode supported by the configured cash register. */
  qrMode: z.enum(['static', 'dynamic', 'hybrid']).optional(),
});

export type MercadoPagoAccountConfig = z.output<typeof MercadoPagoAccountConfigSchema>;

export const mercadoPagoConfigFields: PluginConfigField[] = [
  { name: 'storeId', kind: 'text', required: true, label: { en: 'Store ID', es: 'ID de tienda' } },
  { name: 'externalPosId', kind: 'text', required: true, label: { en: 'Point of sale ID', es: 'ID del punto de venta' } },
  {
    name: 'qrMode',
    kind: 'select',
    required: true,
    label: { en: 'QR mode', es: 'Modo QR' },
    options: [
      { value: 'dynamic', label: { en: 'Dynamic', es: 'Dinámico' } },
      { value: 'static', label: { en: 'Static', es: 'Estático' } },
      { value: 'hybrid', label: { en: 'Hybrid', es: 'Híbrido' } },
    ],
  },
];

export interface MercadoPagoConfigurationStatus {
  hasStoreId: boolean;
  hasExternalPosId: boolean;
  qrMode: MercadoPagoAccountConfig['qrMode'] | null;
  /** Reasons the connector is not yet operational. Empty array means ready to verify. */
  missing: string[];
}

export function evaluateMercadoPagoConfiguration(
  config: unknown,
): MercadoPagoConfigurationStatus {
  const parsed = MercadoPagoAccountConfigSchema.safeParse(config);
  const value = parsed.success ? parsed.data : {};
  const missing: string[] = [];
  if (!value.storeId) missing.push('storeId');
  if (!value.externalPosId) missing.push('externalPosId');
  if (!value.qrMode) missing.push('qrMode');
  return {
    hasStoreId: Boolean(value.storeId),
    hasExternalPosId: Boolean(value.externalPosId),
    qrMode: value.qrMode ?? null,
    missing,
  };
}

/**
 * Returns the safe-to-expose configuration summary for an account. The
 * OAuth authorization is deliberately not represented in this local config;
 * the hosted connector owns the access token and reports authStatus separately.
 */
export function summarizeMercadoPagoAccount(
  account: Pick<ConnectorAccount, 'providerAccountRef' | 'authStatus' | 'readiness' | 'lastHealthCheckAt' | 'lastError'>,
  config: MercadoPagoAccountConfig,
): {
  providerAccountRef: string | null;
  authStatus: ConnectorAccount['authStatus'];
  readiness: ConnectorAccount['readiness'];
  lastHealthCheckAt: string | null;
  lastError: string | null;
  configuration: MercadoPagoConfigurationStatus;
} {
  return {
    providerAccountRef: account.providerAccountRef,
    authStatus: account.authStatus,
    readiness: account.readiness,
    lastHealthCheckAt: account.lastHealthCheckAt,
    lastError: account.lastError,
    configuration: evaluateMercadoPagoConfiguration(config),
  };
}

/**
 * Soul of the connector: the route just dispatches to this handler based
 * on `capability.provider`. Provider-specific lives here, not in the route.
 */
export const mercadoPagoConnectorHandler: ConnectorConfigHandler = {
  provider: 'mercado_pago',
  capabilityId: 'payment.mercado_pago_qr',
  fields: mercadoPagoConfigFields,
  validate(raw) {
    const parsed = MercadoPagoAccountConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`),
        resolved: { storeId: undefined, externalPosId: undefined, qrMode: undefined },
      };
    }
    return { valid: true, errors: [], resolved: parsed.data };
  },
  summarize(account, resolvedConfig) {
    const config = resolvedConfig && typeof resolvedConfig === 'object'
      ? resolvedConfig as MercadoPagoAccountConfig
      : {};
    return summarizeMercadoPagoAccount(account, config);
  },
};
