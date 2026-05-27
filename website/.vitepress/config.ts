import { defineConfig } from 'vitepress';

const SITE_ORIGIN = 'https://metiscoworkai.github.io';
const SITE_BASE = '/metis-cowork/';
const SITE_URL = `${SITE_ORIGIN}${SITE_BASE}`;
const OG_IMAGE = `${SITE_URL}og-image.png`;
const GITHUB_URL = 'https://github.com/MetisCoworkAI/metis-cowork';
const RELEASES_URL = `${GITHUB_URL}/releases`;
const DISCORD_URL = 'https://discord.gg/pynjtQDf';
const PROJECT_DESCRIPTION =
  'Local data-processing AI agent desktop app for Windows and macOS with sandbox isolation, multi-model support, built-in Skills, MCP integration, GUI automation, and remote control.';
const FEATURE_LIST = [
  'One-click installers for Windows and macOS',
  'Local data processing for files, spreadsheets, reports, and datasets',
  'Multi-model support for Claude, GPT, Gemini, DeepSeek, GLM, MiniMax, Kimi, and OpenAI-compatible APIs',
  'VM sandbox isolation with WSL2 on Windows and Lima on macOS',
  'Built-in Skills for PPTX, DOCX, XLSX, and PDF workflows',
  'MCP integration for browsers, Notion, and other desktop tools',
  'GUI automation through computer use',
  'Remote control through Feishu (Lark) and Slack',
  'Local-first operation with no Metis Cowork telemetry',
];
const FAQ_ITEMS = [
  {
    question: 'What is Metis Cowork?',
    answer:
      'Metis Cowork is a free, open-source local data-processing agent for Windows and macOS. It helps analyze, clean, transform, summarize, and organize workspace files.',
  },
  {
    question: 'What AI models are supported?',
    answer:
      'Metis Cowork supports Claude through Anthropic or OpenRouter, OpenAI-compatible APIs, and models such as Gemini, DeepSeek, GLM, MiniMax, and Kimi.',
  },
  {
    question: 'Is Metis Cowork free?',
    answer:
      'Yes. Metis Cowork is free and open-source under the MIT license. Users pay only for usage from their chosen AI model provider.',
  },
  {
    question: 'How does sandbox isolation work?',
    answer:
      'Metis Cowork uses WSL2 on Windows and Lima on macOS to run AI-executed commands inside an isolated Linux VM when available, with path-based workspace restrictions as a baseline.',
  },
  {
    question: 'Does Metis Cowork send data to its own servers?',
    answer:
      'No. Metis Cowork runs locally. The only external communication is with the AI model API configured by the user.',
  },
];
const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}#organization`,
      name: 'MetisCoworkAI',
      url: 'https://github.com/MetisCoworkAI',
      sameAs: ['https://github.com/MetisCoworkAI', DISCORD_URL],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}#website`,
      name: 'Metis Cowork',
      url: SITE_URL,
      inLanguage: ['en', 'zh-CN'],
      publisher: { '@id': `${SITE_URL}#organization` },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}#software`,
      name: 'Metis Cowork',
      description: PROJECT_DESCRIPTION,
      url: SITE_URL,
      image: OG_IMAGE,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: ['Windows', 'macOS'],
      codeRepository: GITHUB_URL,
      downloadUrl: RELEASES_URL,
      license: 'https://opensource.org/licenses/MIT',
      softwareVersion: '3.3.0',
      isAccessibleForFree: true,
      featureList: FEATURE_LIST,
      author: { '@id': `${SITE_URL}#organization` },
      publisher: { '@id': `${SITE_URL}#organization` },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}#faq`,
      url: SITE_URL,
      mainEntity: FAQ_ITEMS.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    },
  ],
};

export default defineConfig({
  title: 'Metis Cowork',
  description:
    'Local data-processing AI agent desktop app for Windows & macOS with sandbox isolation, multi-model support, MCP tools, and Skills.',

  base: SITE_BASE,

  head: [
    ['link', { rel: 'icon', href: '/metis-cowork/logo.png' }],
    [
      'link',
      { rel: 'alternate', type: 'text/plain', title: 'llms.txt', href: '/metis-cowork/llms.txt' },
    ],
    [
      'link',
      {
        rel: 'alternate',
        type: 'text/markdown',
        title: 'Full AI context',
        href: '/metis-cowork/llms-full.txt',
      },
    ],
    [
      'link',
      {
        rel: 'alternate',
        type: 'application/json',
        title: 'Metis Cowork project metadata',
        href: '/metis-cowork/project.json',
      },
    ],
    ['meta', { name: 'application-name', content: 'Metis Cowork' }],
    [
      'meta',
      {
        name: 'robots',
        content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
      },
    ],
    // Open Graph
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Metis Cowork — Local Data Agent Desktop App' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Free local data-processing AI agent for Windows & macOS. Process files, spreadsheets, reports, and datasets with sandbox isolation.',
      },
    ],
    ['meta', { property: 'og:image', content: OG_IMAGE }],
    ['meta', { property: 'og:url', content: SITE_URL }],
    // Twitter Card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'Metis Cowork — Local Data Agent Desktop App' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'Free local data-processing AI agent for Windows & macOS. One-click install, multi-model, sandbox isolation.',
      },
    ],
    ['meta', { name: 'twitter:image', content: OG_IMAGE }],
    // SEO
    [
      'meta',
      {
        name: 'keywords',
        content:
          'Metis Cowork, local data agent, data processing, AI agent, desktop app, spreadsheet analysis, report generation, MCP, Skills, sandbox, open source, Windows, macOS, multi-model',
      },
    ],
    // Schema.org JSON-LD
    ['script', { type: 'application/ld+json' }, JSON.stringify(STRUCTURED_DATA)],
  ],

  sitemap: { hostname: SITE_URL },

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Download', link: 'https://github.com/MetisCoworkAI/metis-cowork/releases' },
      { text: 'GitHub', link: 'https://github.com/MetisCoworkAI/metis-cowork' },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/MetisCoworkAI/metis-cowork' },
      { icon: 'discord', link: 'https://discord.gg/pynjtQDf' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: '© 2025-present MetisCoworkAI',
    },

    search: { provider: 'local' },
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en',
    },
    zh: {
      label: '中文',
      lang: 'zh-CN',
      description: '免费开源、专注本地数据处理的 AI Agent 桌面应用，支持 Windows 和 macOS。',
      themeConfig: {
        nav: [
          { text: '首页', link: '/zh/' },
          { text: '下载', link: 'https://github.com/MetisCoworkAI/metis-cowork/releases' },
          { text: 'GitHub', link: 'https://github.com/MetisCoworkAI/metis-cowork' },
        ],
        footer: {
          message: '基于 MIT 协议开源。',
          copyright: '© 2025-present MetisCoworkAI',
        },
      },
    },
  },
});
