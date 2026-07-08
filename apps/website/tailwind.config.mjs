export default {
  content: [
    './src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Strata brand colors from brand-guide.md
        // Teal: #39D0C6
        teal: {
          50: '#f0fdfc',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#39d0c6',
          500: '#2dd4bf',
          600: '#14b8a6',
          700: '#0d9488',
          800: '#0f766e',
          900: '#115e59',
        },
        // Sandstone: #E28C3C
        sandstone: {
          50: '#fef7f0',
          100: '#fdead3',
          200: '#fbd5a7',
          300: '#f7c27b',
          400: '#e28c3c',
          500: '#d97706',
          600: '#b45309',
          700: '#92400e',
          800: '#78350f',
          900: '#451a03',
        },
        // Terracotta: #C54B3A
        terracotta: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#c54b3a',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        // Terracotta: #C54B3A
        terracotta: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#c54b3a',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
