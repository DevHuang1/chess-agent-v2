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
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // app/page.tsx intentionally reads refs for display (move history,
    // opening name, undo availability) and captures timestamps inside event
    // handlers. The React Compiler lint rules flag both patterns, but the
    // inline eslint-disable comments keep getting stripped by the formatter,
    // so the exceptions live here instead.
    files: ["app/page.tsx"],
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
    },
  },
]);

export default eslintConfig;
