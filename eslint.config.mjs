import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["**/dist/**", "**/node_modules/**"]),
  {
    files: ["gateway/src/**/*.ts", "agentbox/adapter/src/**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
);
