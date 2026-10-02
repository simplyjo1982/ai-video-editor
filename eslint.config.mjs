import { defineConfig, globalIgnores } from "eslint/config";
import javascript from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import typescript from "typescript-eslint";

export default defineConfig([
  javascript.configs.recommended,
  ...typescript.configs.recommended,
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    settings: { next: { rootDir: "apps/web/" } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/next-env.d.ts",
    ".local/**",
    "coverage/**",
  ]),
]);
