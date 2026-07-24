import { definePluginRuntimeBundle, PluginRuntimeKind } from '../api-types';
import { TH_MANIFEST } from './manifest';
import { thTaxEngine } from './tax-engine';

export const TH_RUNTIME_BUNDLE = definePluginRuntimeBundle({
  manifest: TH_MANIFEST,
  runtimes: [{ kind: PluginRuntimeKind.Tax, connector: thTaxEngine }],
});
