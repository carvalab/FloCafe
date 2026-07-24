import { definePluginRuntimeBundle, PluginRuntimeKind } from '../api-types';
import { AR_MANIFEST } from './manifest';
import { arTaxEngine } from './tax-engine';

export const AR_RUNTIME_BUNDLE = definePluginRuntimeBundle({
  manifest: AR_MANIFEST,
  runtimes: [{ kind: PluginRuntimeKind.Tax, connector: arTaxEngine }],
});
