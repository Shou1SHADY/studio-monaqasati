import tseslint from 'typescript-eslint';

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
