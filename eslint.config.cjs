const js = require('@eslint/js');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const reactHooks = require('eslint-plugin-react-hooks');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'dist-mcp/**',
      'dist-wsl-agent/**',
      'dist-lima-agent/**',
      'node_modules/**',
      'website/**',
      'artifacts/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { '@typescript-eslint': tsPlugin, 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,
      ...tsPlugin.configs.recommended.rules,
      // New ESLint 10 checks are advisory during this dependency migration.
      // Keep the previous lint errors enforced without rewriting unrelated logic.
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}', 'src/tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
  // Keep the existing cross-process architecture boundaries enforced.
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
];
