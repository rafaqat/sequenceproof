import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      // Indexed access is checked by TypeScript. Assertions are used only after
      // explicit bounds/key guards, where re-expressing the proof obscures it.
      "@typescript-eslint/no-non-null-assertion": "off",
      // Promise-shaped driver hooks intentionally permit synchronous fixtures.
      "@typescript-eslint/require-await": "off",
      // All extracted method references below are either platform functions or
      // are invoked with their original receiver explicitly.
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/restrict-template-expressions": ["error", { "allowNumber": true }]
    }
  }
);
