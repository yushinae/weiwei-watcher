// Scoped ESLint — intentionally minimal.
//
// We deliberately do NOT enable @eslint/js or typescript-eslint "recommended" sets:
// this codebase predates strict typing and would surface ~4.7k no-explicit-any /
// no-unused-vars findings (those are already covered by tsc's noUnusedLocals).
//
// Instead we run only the react-hooks rules, which need no type info and catch
// genuine bugs:
//   • rules-of-hooks   → error  (conditional/loop hook calls = real crashes)
//   • exhaustive-deps  → warn   (stale-closure hints; non-blocking)
//
// Run: `npm run lint:eslint`  (type-checking stays in `npm run lint` = tsc).

import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '*.config.js', '*.config.ts'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
