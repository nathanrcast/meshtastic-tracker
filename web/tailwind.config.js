/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ['var(--t-font-data)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        mesh: {
          50: '#ecfeff', 100: '#cffafe', 200: '#a5f3fc', 300: '#67e8f9',
          400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2', 700: '#0e7490',
          800: '#155e75', 900: '#164e63', 950: '#083344',
        },
        th: {
          base: 'rgb(var(--t-base) / <alpha-value>)',
          surface: 'rgb(var(--t-surface) / <alpha-value>)',
          elevated: 'rgb(var(--t-elevated) / <alpha-value>)',
          hover: 'rgb(var(--t-hover) / <alpha-value>)',
          text: 'rgb(var(--t-text) / <alpha-value>)',
          body: 'rgb(var(--t-body) / <alpha-value>)',
          dim: 'rgb(var(--t-dim) / <alpha-value>)',
          muted: 'rgb(var(--t-muted) / <alpha-value>)',
          faint: 'rgb(var(--t-faint) / <alpha-value>)',
          border: 'rgb(var(--t-border) / <alpha-value>)',
          'border-strong': 'rgb(var(--t-border-strong) / <alpha-value>)',
          accent: 'rgb(var(--t-accent) / <alpha-value>)',
          'accent-light': 'rgb(var(--t-accent-light) / <alpha-value>)',
          'accent-dim': 'rgb(var(--t-accent-dim) / <alpha-value>)',
          'accent-bg': 'rgb(var(--t-accent-bg) / <alpha-value>)',
          'accent-border': 'rgb(var(--t-accent-border) / <alpha-value>)',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'fade-in-up': 'fadeInUp 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
};
