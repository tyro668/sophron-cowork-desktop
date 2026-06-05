/** @type {import('tailwindcss').Config} */
const colorVar = (name) => `rgb(var(${name}) / <alpha-value>)`;

module.exports = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Use CSS variables for theme-aware colors
        background: {
          DEFAULT: colorVar('--color-background-rgb'),
          secondary: colorVar('--color-background-secondary-rgb'),
        },
        surface: {
          DEFAULT: colorVar('--color-surface-rgb'),
          hover: colorVar('--color-surface-hover-rgb'),
          active: colorVar('--color-surface-active-rgb'),
          muted: colorVar('--color-surface-muted-rgb'),
        },
        border: {
          DEFAULT: colorVar('--color-border-rgb'),
          muted: colorVar('--color-border-muted-rgb'),
          subtle: colorVar('--color-border-subtle-rgb'),
        },
        accent: {
          DEFAULT: colorVar('--color-accent-rgb'),
          hover: colorVar('--color-accent-hover-rgb'),
          muted: colorVar('--color-accent-muted-rgb'),
        },
        mcp: {
          DEFAULT: colorVar('--color-mcp-rgb'),
        },
        text: {
          primary: colorVar('--color-text-primary-rgb'),
          secondary: colorVar('--color-text-secondary-rgb'),
          muted: colorVar('--color-text-muted-rgb'),
        },
        success: colorVar('--color-success-rgb'),
        warning: colorVar('--color-warning-rgb'),
        error: colorVar('--color-error-rgb'),
      },
      fontFamily: {
        sans: [
          'PingFang SC',
          'Inter',
          'SF Pro Text',
          'Microsoft YaHei UI',
          'Noto Sans SC',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'soft': 'var(--shadow-soft)',
        'card': 'var(--shadow-card)',
        'elevated': 'var(--shadow-elevated)',
      },
      opacity: {
        '18': '0.18',
        '24': '0.24',
        '28': '0.28',
        '34': '0.34',
        '35': '0.35',
        '38': '0.38',
        '42': '0.42',
        '45': '0.45',
        '46': '0.46',
        '48': '0.48',
        '55': '0.55',
        '58': '0.58',
        '62': '0.62',
        '64': '0.64',
        '68': '0.68',
        '72': '0.72',
        '86': '0.86',
        '88': '0.88',
        '92': '0.92',
        '94': '0.94',
        '96': '0.96',
      },
      borderRadius: {
        'lg': '8px',
        'xl': '10px',
        '2xl': '14px',
        '3xl': '16px',
      },
      backgroundImage: {
        'grid-pattern': `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4d2cc' fill-opacity='0.4'%3E%3Cpath d='M0 0h1v40H0V0zm39 0h1v40h-1V0z'/%3E%3Cpath d='M0 0h40v1H0V0zm0 39h40v1H0v-1z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'spin-slow': 'spin 2s linear infinite',
        'expand': 'expand 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        expand: {
          '0%': { opacity: '0', maxHeight: '0' },
          '100%': { opacity: '1', maxHeight: '500px' },
        },
      },
    },
  },
  plugins: [],
}
