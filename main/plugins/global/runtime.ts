/**
 * Global default package runtime bundle.
 */

import { definePluginRuntimeBundle, PluginRuntimeKind } from '../api-types';
import { GLOBAL_DEFAULT_MANIFEST } from './manifest';
import { defaultTaxEngine } from './tax-engine';

export const GLOBAL_DEFAULT_RUNTIME_BUNDLE = definePluginRuntimeBundle({
  manifest: GLOBAL_DEFAULT_MANIFEST,
  runtimes: [{ kind: PluginRuntimeKind.Tax, connector: defaultTaxEngine }],
});
