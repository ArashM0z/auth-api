// Frontend lint profile: typescript-eslint recommended + react-hooks.
// Deliberately not the backend's strict-type-checked config — tsc --noEmit
// (strict) is the primary type gate here; eslint adds the React-specific
// correctness rules (hooks deps, rules-of-hooks).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['node_modules/', '../pages-dist/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
);
