import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src-tauri", "**/*.test.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/rules-of-hooks": "off",
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": "off",
      "no-constant-condition": "off",
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-cond-assign": "off",
      "no-fallthrough": "off",
      "no-case-declarations": "off",
      "no-extra-boolean-cast": "off",
      "no-misleading-character-class": "off",
      "no-async-promise-executor": "off",
      "no-prototype-builtins": "off",
      "no-self-assign": "off",
      "no-sparse-arrays": "off",
      "no-unexpected-multiline": "off",
      "no-useless-catch": "off",
      "no-useless-rename": "off",
      "prefer-const": "off",
    },
  },
);
