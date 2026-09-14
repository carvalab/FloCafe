import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import next from "ultracite/oxlint/next";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, next, react, antiSlop],
  ignorePatterns: core.ignorePatterns,
  jsPlugins: ["oxlint-plugin-complexity", "@shadcn/lint"],
  rules: {
    "complexity/complexity": ["error", { cognitive: 15 }],
    // Static export uses dynamic data URLs, QR codes, and user-selected
    // product images; next/image optimization is unavailable in Electron.
    // (Carried over from eslint.config.mjs: @next/next/no-img-element off.)
    "nextjs/no-img-element": "off",
    // Ultracite disables these native rules in favor of react-doctor's JS
    // versions; re-enable the native ones to keep the fast Rust-only pass.
    "react/no-array-index-key": "error",
    "react/only-export-components": "error",
  },
});
