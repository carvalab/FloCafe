import { definePluginRuntimeBundle, PluginRuntimeKind } from '../api-types';
import { IN_MANIFEST } from './manifest';
import { inTaxEngine } from './tax-engine';

export const IN_RUNTIME_BUNDLE = definePluginRuntimeBundle({
  manifest: IN_MANIFEST,
  runtimes: [{ kind: PluginRuntimeKind.Tax, connector: inTaxEngine }],
});
