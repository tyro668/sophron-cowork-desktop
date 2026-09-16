module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'dist-electron', 'dist-mcp', 'dist-wsl-agent', 'dist-lima-agent', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
  overrides: [
    // Architectural boundaries: cross-process types live in src/shared/contracts.
    // See src/tests/contracts/architecture-boundaries.test.ts for the CI check.
    {
      files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '../renderer/**',
                  '../../renderer/**',
                  '../../../renderer/**',
                  '../../../../renderer/**',
                  '@renderer/**',
                  '@/renderer/**',
                ],
                message:
                  'main/preload must not import from renderer/. Cross-process types belong in src/shared/contracts/.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/shared/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '../main/**',
                  '../../main/**',
                  '../../../main/**',
                  '../renderer/**',
                  '../../renderer/**',
                  '../../../renderer/**',
                  '../preload/**',
                  '../../preload/**',
                  '../../../preload/**',
                  '@main/**',
                  '@/main/**',
                  '@renderer/**',
                  '@/renderer/**',
                ],
                message:
                  'shared/ must not depend on main/, renderer/, or preload/ — it is the shared contract layer.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '../main/**',
                  '../../main/**',
                  '../../../main/**',
                  '../../../../main/**',
                  '../preload/**',
                  '../../preload/**',
                  '../../../preload/**',
                  '@main/**',
                  '@/main/**',
                ],
                message:
                  'renderer/ must not import from main/ or preload/ — use the electronAPI bridge.',
              },
            ],
          },
        ],
      },
    },
  ],
};

