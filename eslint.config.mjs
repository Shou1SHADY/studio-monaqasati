import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/** @type {import('eslint').Linter.Config[]} */
export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow unused vars with underscore prefix
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Disable no-explicit-any since any is heavily used in this codebase
      '@typescript-eslint/no-explicit-any': 'off',
      // Allow empty interfaces
      '@typescript-eslint/no-empty-interface': 'off',
      // Disable no-undef since typescript handles it
      'no-undef': 'off',
    },
  },
  {
    // A hook after an early return runs on some renders only, and React throws #310 (18 Oct 2026: the portal home,
    // the sidebar and the supplier account). Only that rule — the dependency-list advice stays off.
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'coverage/**',
      '*.config.js',
      '*.config.ts',
      '*.config.mjs',
    ],
  }
);
