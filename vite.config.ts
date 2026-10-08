import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import { resolve } from 'path';
import { builtinModules } from 'module';
import { piSdkResolve } from './scripts/pi-sdk-resolve';

// Node built-in modules must be external for Electron main process
const nodeBuiltins = builtinModules.flatMap((m) => [m, `node:${m}`]);
const ignoredWatchPaths = [
  '**/release/**',
  '**/dist/**',
  '**/dist-electron/**',
  '**/dist-wsl-agent/**',
  '**/dist-lima-agent/**',
  '**/dist-mcp/**',
];

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        onstart(args) {
          args.startup(['.', '--remote-debugging-port=9223']);
        },
        vite: {
          resolve: piSdkResolve,
          build: {
            outDir: 'dist-electron/main',
            emptyOutDir: true,
            rolldownOptions: {
              external: [
                ...nodeBuiltins,
                'better-sqlite3',
                '@duckdb/node-api',
                '@duckdb/node-bindings',
                '@duckdb/node-bindings-darwin-arm64',
                '@duckdb/node-bindings-darwin-x64',
                '@duckdb/node-bindings-linux-arm64',
                '@duckdb/node-bindings-linux-arm64-musl',
                '@duckdb/node-bindings-linux-x64',
                '@duckdb/node-bindings-linux-x64-musl',
                '@duckdb/node-bindings-win32-arm64',
                '@duckdb/node-bindings-win32-x64',
                'bufferutil',
                'utf-8-validate',
                'electron',
                // Externalize large CJS-compatible main-process dependencies
                // NOTE: ESM-only packages (@earendil-works/pi-coding-agent, pi-ai, electron-store, uuid)
                // must stay bundled — CJS require() can't load them
                '@anthropic-ai/sdk',
                '@larksuiteoapi/node-sdk',
                'openai',
                '@modelcontextprotocol/sdk',
                'electron-updater',
                'chokidar',
                'archiver',
                'ngrok',
                'ws',
                'glob',
                'dotenv',
              ],
            },
          },
        },
      },
      {
        entry: 'src/preload/index.ts',
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            emptyOutDir: true,
            rolldownOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  server: {
    watch: {
      ignored: ignoredWatchPaths,
    },
  },
  build: {
    sourcemap: process.env.NODE_ENV !== 'production',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
