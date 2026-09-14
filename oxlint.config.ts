import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core, antiSlop],
  ignorePatterns: core.ignorePatterns,
  jsPlugins: ["oxlint-plugin-complexity"],
  rules: {
    "complexity/complexity": ["error", { cognitive: 15 }],
  },
});
