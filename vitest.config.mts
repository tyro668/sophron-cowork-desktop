import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Resolve Electron to a stable test double so CI does not depend on the
    // postinstall-generated `node_modules/electron/path.txt` file.
    alias: {
      electron: path.resolve(import.meta.dirname, './tests/mocks/electron.ts'),
    },
    server: {
      deps: {
        inline: ['electron-store'],
      },
    },
    include: [
      'src/**/*.{test,spec}.{js,ts,tsx}',
      'tests/**/*.{test,spec}.{js,ts,tsx}',
    ],
    exclude: ['node_modules', 'dist', 'dist-electron', '.claude'],
    coverage: {
      provider: 'v8',
      // text: human-readable table in CI logs; json-summary: machine-readable for badge tools
      reporter: ['text', 'text-summary', 'json', 'json-summary', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'dist-electron/',
        'src/tests/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
      ],
      thresholds: {
        // Renderer is measured now (previously excluded entirely). Its floor is
        // intentionally low and should ratchet up as feature/hook tests grow;
        // files matching a pattern are not counted toward the global numbers.
        'src/renderer/**': {
          lines: 8,
          functions: 8,
          branches: 5,
          statements: 8,
        },
        lines: 30,
        functions: 35,
        branches: 28,
        statements: 30,
      },
    },
    mockReset: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
