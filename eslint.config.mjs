import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

/** Enforces required style (semicolons) on TypeScript sources. */
export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,mts,cts}'],
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      '@stylistic/semi': ['error', 'always'],
      // Single-statement if/else/for/while: no braces, body on the same line.
      // Keep braces only for multi-statement bodies (see .cursor/rules/brace-style.mdc).
      curly: ['error', 'multi'],
      '@stylistic/nonblock-statement-body-position': ['error', 'beside'],
    },
  },
  {
    ignores: ['node_modules/**'],
  },
);
