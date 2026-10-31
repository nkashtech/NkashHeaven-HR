/** @type {import('tailwindcss').Config} */

// Colours resolve to CSS variables from src/index.css so the whole UI switches with the .dark class.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        shell: v('shell'),
        panel: v('panel'),
        card: v('card'),
        subtle: v('subtle'),
        line: v('line'),
        ink: { DEFAULT: v('ink'), soft: v('ink-soft'), muted: v('ink-muted') },
        brand: { DEFAULT: v('brand'), bright: v('brand-bright'), soft: v('brand-soft'), ink: v('brand-ink') },
        ok: { DEFAULT: v('ok'), soft: v('ok-soft') },
        warn: { DEFAULT: v('warn'), soft: v('warn-soft') },
        bad: { DEFAULT: v('bad'), soft: v('bad-soft') },
        info: { DEFAULT: v('info'), soft: v('info-soft') },
        teal: v('teal'),
        violet: v('violet'),
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      borderRadius: { xl2: '1.125rem' },
      boxShadow: {
        soft: '0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.04)',
        pop: '0 10px 30px -8px rgb(16 24 40 / 0.22)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
      },
      animation: { 'fade-up': 'fade-up .2s ease-out' },
    },
  },
  plugins: [],
}
