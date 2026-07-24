import { PluginCapabilityKind, PluginPermission, type PluginManifest } from '../api-types';

export const TH_MANIFEST = {
  manifestVersion: 1,
  id: 'country.th',
  version: '1.0.0',
  publisher: { id: 'flo-verified', name: 'Flo' },
  displayName: { en: 'Thailand operations' },
  scope: 'country',
  countries: ['TH'],
  floApiVersion: '>=1.0.0 <2.0.0',
  execution: ['in_process'],
  capabilities: [
    { id: 'tax.vat', kind: PluginCapabilityKind.Tax, execution: 'in_process', provider: 'th_vat', operations: ['calculate'], displayName: { en: 'VAT calculation', es: 'Cálculo de IVA' }, description: { en: 'Calculate Thailand VAT lines using the country tax package.', es: 'Calcula líneas de IVA tailandés usando el paquete fiscal del país.' } },
  ],
  permissions: [PluginPermission.SettingsRead, PluginPermission.SettingsWrite, PluginPermission.FiscalWrite],
  artifact: { digest: 'sha256:stage1-th-inrepo', signature: 'stage1-in-repo' },
} satisfies PluginManifest;
