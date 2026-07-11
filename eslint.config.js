// ESLint 10 flat config (the only supported format in v10).
// Type-aware linting via typescript-eslint's projectService.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // web/ (the React landing) lints with its own profile — react-hooks rules
  // and browser globals don't belong in the backend's; see web/eslint.config.js.
  {
    ignores: [
      'dist/',
      'coverage/',
      'node_modules/',
      'client/api.d.ts',
      'infra/',
      'web/',
      'pages-dist/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Fastify handlers return values that are intentionally unawaited replies.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // JS config files are not part of the typed project.
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
