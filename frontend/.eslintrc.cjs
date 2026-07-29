/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules', '*.cjs', '*.config.js'],
  rules: {
    /**
     * Fast Refresh only works when a module exports components exclusively.
     *
     * Several modules here deliberately export a component alongside a related
     * helper — `Badge` with `badgeVariants`, `AuthProvider` with `useAuth`,
     * `Toaster` with `toast`. That co-location is the point: a consumer that
     * imports the component almost always wants the helper too, and splitting
     * them would scatter one concept across two files for a dev-server
     * optimisation.
     *
     * Rather than silencing the rule (which would hide genuine violations) or
     * leaving eleven permanent warnings (which trains people to ignore output),
     * the known-good export names are allow-listed. Anything else still warns.
     */
    'react-refresh/only-export-components': [
      'warn',
      {
        allowConstantExport: true,
        allowExportNames: [
          'badgeVariants',
          'buttonVariants',
          'toastVariants',
          'statusVariant',
          'fieldAria',
          'buildPageWindow',
          'useAuth',
          'useTheme',
          'useToast',
          'toast',
          'toastApiError',
        ],
      },
    ],

    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'always'],
  },
};
