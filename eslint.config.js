// Root ESLint config: the shared base applied to the repository's own tooling scripts.

import globals from 'globals';
import base from './eslint.config.base.js';

export default [
  ...base,
  {
    files: ['scripts/**', '.github/scripts/**'],
    languageOptions: { globals: globals.node },
  },
];
