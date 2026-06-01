const { getBrand } = require('./scripts/sophron-brand.cjs');

const brand = getBrand();

const artifactPattern = `${brand.artifactName}-\${version}`;
const updatePublishUrl = process.env.SOPHRON_UPDATE_PUBLISH_URL || 'https://download.sophron.ai/updates/stable';

module.exports = {
  appId: 'com.sophron.app',
  productName: brand.productName,
  copyright: `Copyright © 2026 ${brand.copyrightOwner}`,

  directories: {
    output: `release/${brand.artifactName}`,
    buildResources: 'resources',
  },

  npmRebuild: true,
  afterPack: './scripts/after-pack.js',
  afterAllArtifactBuild: './scripts/compress-dmg.js',
  publish: [
    {
      provider: 'generic',
      url: updatePublishUrl,
    },
  ],

  files: [
    'dist/**/*',
    'dist-electron/**/*',
    'package.json',
    'node_modules/@img/**/*',
    'node_modules/better-sqlite3/**/*',
    'node_modules/@duckdb/**/*',
    'node_modules/@anthropic-ai/sdk/**/*',
    'node_modules/@larksuiteoapi/**/*',
    'node_modules/openai/**/*',
    'node_modules/@modelcontextprotocol/**/*',
    'node_modules/chokidar/**/*',
    'node_modules/archiver/**/*',
    'node_modules/ngrok/**/*',
    'node_modules/ws/**/*',
    'node_modules/glob/**/*',
    'node_modules/dotenv/**/*',
    'node_modules/electron-updater/**/*',
    'node_modules/builder-util-runtime/**/*',
    'node_modules/fs-extra/**/*',
    'node_modules/js-yaml/**/*',
    'node_modules/lazy-val/**/*',
    'node_modules/lodash.escaperegexp/**/*',
    'node_modules/lodash.isequal/**/*',
    'node_modules/semver/**/*',
    'node_modules/tiny-typed-emitter/**/*',
    'node_modules/bufferutil/**/*',
    'node_modules/utf-8-validate/**/*',
    '!**/*.js.map',
    '!**/*.mjs.map',
    '!**/*.d.ts.map',
    '!**/*.mts.map',
    '!**/*.d.ts',
    '!**/*.ts',
    '!**/README.md',
    '!**/LICENSE',
    '!**/LICENSE.md',
    '!**/.npmignore',
    '!**/.eslintrc*',
    '!**/tsconfig.json',
  ],

  asarUnpack: [
    'node_modules/@img/**/*.node',
    'node_modules/@img/**/*.dll',
    'node_modules/@img/**/*.dylib',
    'node_modules/@img/**/*.so',
    'node_modules/better-sqlite3/**/*.node',
    'node_modules/@duckdb/**/*.node',
    'node_modules/@duckdb/**/*.dll',
    'node_modules/@duckdb/**/*.dylib',
    'node_modules/@duckdb/**/*.so',
    'node_modules/bufferutil/**/*.node',
    'node_modules/utf-8-validate/**/*.node',
  ],

  win: {
    icon: 'resources/icon.ico',
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    artifactName: `${artifactPattern}-win-\${arch}.\${ext}`,
    signAndEditExecutable: false,
    extraResources: [
      { from: '.bundle-resources/mcp', to: 'mcp' },
      { from: 'resources/node/win32-x64', to: 'node' },
      { from: 'resources/node/win32-x64/node_modules/npm', to: 'node/node_modules/npm' },
      { from: 'dist-wsl-agent', to: 'wsl-agent' },
      { from: '.claude/skills', to: 'skills' },
    ],
  },

  mac: {
    icon: 'resources/icon.icns',
    target: [
      {
        target: 'dmg',
        arch: ['arm64'],
      },
      {
        target: 'zip',
        arch: ['arm64'],
      },
    ],
    artifactName: `${artifactPattern}-mac-\${arch}.\${ext}`,
    identity: 'auto',
    hardenedRuntime: true,
    gatekeeperAssess: true,
    entitlements: 'resources/entitlements.mac.plist',
    entitlementsInherit: 'resources/entitlements.mac.plist',
    extendInfo: {
      LSApplicationCategoryType: 'public.app-category.developer-tools',
      NSScreenCaptureUsageDescription: `${brand.productName} needs screen recording access for GUI automation.`,
      NSAccessibilityUsageDescription: `${brand.productName} needs accessibility access for GUI automation.`,
    },
    extraResources: [
      { from: '.bundle-resources/mcp', to: 'mcp' },
      { from: 'resources/node/darwin-${arch}', to: 'node' },
      { from: 'resources/node/darwin-${arch}/lib/node_modules/npm', to: 'node/lib/node_modules/npm' },
      { from: 'resources/python/darwin-${arch}', to: 'python' },
      { from: 'resources/tools/darwin-${arch}', to: 'tools' },
      { from: 'dist-lima-agent', to: 'lima-agent' },
      { from: '.claude/skills', to: 'skills' },
    ],
  },

  linux: {
    icon: 'resources/icon.png',
    target: [
      {
        target: 'AppImage',
        arch: ['x64'],
      },
    ],
    artifactName: `${artifactPattern}-linux-\${arch}.\${ext}`,
    extraResources: [
      { from: '.bundle-resources/mcp', to: 'mcp' },
      { from: 'resources/node/linux-x64', to: 'node' },
      { from: 'resources/node/linux-x64/lib/node_modules/npm', to: 'node/lib/node_modules/npm' },
      { from: 'resources/python/linux-${arch}', to: 'python' },
      { from: '.claude/skills', to: 'skills' },
    ],
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    include: 'installer.nsh',
    warningsAsErrors: false,
    deleteAppDataOnUninstall: false,
  },

  dmg: {
    size: '3g',
    window: {
      width: 600,
      height: 440,
    },
    contents: [
      {
        x: 150,
        y: 220,
        name: `${brand.productName}.app`,
      },
      {
        x: 450,
        y: 220,
        type: 'link',
        path: '/Applications',
        name: 'Applications',
      },
    ],
  },

  extraMetadata: {
    name: 'sophron',
    main: 'dist-electron/main/index.js',
  },
};
