// Shared ESLint flat config: the rules every workspace package (and the root tooling) inherits.

import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'src/generated/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // TypeScript itself reports undefined identifiers; the core rule has no
      // notion of DOM/Node globals or type-only references.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      curly: ['error', 'all'],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 3],
      complexity: ['error', 12],
      'max-params': ['error', 4],
      'id-length': [
        'error',
        { min: 2, exceptions: ['i', 'j', 'k', 'x', 'y', 'z', '_'], properties: 'never' },
      ],
    },
  },
  {
    // describe/it nesting and table-driven cases are how tests are meant to be written.
    files: [
      '**/test/**',
      '**/tests/**',
      '**/Tests/**',
      '**/*-tests/**',
      '**/*.test.*',
      '**/*.spec.*',
    ],
    rules: {
      'max-lines-per-function': 'off',
      'max-depth': 'off',
      complexity: 'off',
    },
  },
  {
    // Ambient declarations describe signatures; unused parameter names are normal.
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
