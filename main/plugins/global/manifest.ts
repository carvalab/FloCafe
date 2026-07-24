/**
 * Global default tax plugin — package manifest.
 *
 * Flo ships this as the in-repo, builtin fallback for every country that
 * does not have a dedicated `country.<code>` package installed. It
 * mirrors the original core tax calculation byte-for-byte:
 *
 *  - Every country uses `product.tax_rate` as-is, with the tax label
 *    taken from the country table's `taxName` (falls back to "Tax").
 *  - Inclusive math extracts tax from the unit price; exclusive math
 *    adds it on top.
 *
 * It is auto-installed and activated during first-run setup for any store
 * country that isn't AR or IN. The runtime registry picks it only when no
 * activated country-specific package matches, so AR and IN keep their
 * dedicated math (IVA / GST). Hosted connectors from this package would
 * be the future broker surface; for now the manifest declares only the
 * in-process tax engine.
 */

import { PluginCapabilityKind, PluginPermission, type PluginManifest } from '../api-types';

export const GLOBAL_DEFAULT_MANIFEST = {
  manifestVersion: 1,
  id: 'global.default',
  version: '1.0.0',
  publisher: { id: 'flo-verified', name: 'Flo' },
  displayName: { en: 'Default tax engine', es: 'Motor de impuestos por defecto' },
  scope: 'global',
  countries: [],
  floApiVersion: '>=1.0.0 <2.0.0',
  execution: ['in_process'],
  capabilities: [
    // Generic tax engine — covers every country without a dedicated
    // country.<code> package and uses the product's own rate.
    { id: 'tax.default', kind: PluginCapabilityKind.Tax, execution: 'in_process', provider: 'default_tax', operations: ['calculate'], displayName: { en: 'Default tax calculation', es: 'Cálculo de impuestos por defecto' }, description: { en: 'Calculate product-rate tax for countries without a dedicated country package.', es: 'Calcula impuestos según la tasa del producto para países sin un paquete dedicado.' } },
  ],
  permissions: [
    PluginPermission.SettingsRead,
    PluginPermission.SettingsWrite,
    PluginPermission.FiscalWrite,
  ],
  artifact: { digest: 'sha256:stage1-global-default-inrepo', signature: 'stage1-in-repo' },
} satisfies PluginManifest;
