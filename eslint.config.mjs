import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    // npm run copy-worker 로 복사되는 MapLibre 번들
    "public/maplibre-gl-worker.mjs",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
