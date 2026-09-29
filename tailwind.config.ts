import type { Config } from 'tailwindcss';

const v = (name: string) => `var(--${name})`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        rail: v('rail'),
        border: v('border'),
        'border-soft': v('border-soft'),
        text: v('text'),
        muted: v('text-muted'),
        accent: { DEFAULT: v('accent'), soft: v('accent-soft'), text: v('accent-text') },
        success: { DEFAULT: v('success'), soft: v('success-soft'), text: v('success-text') },
        warning: { DEFAULT: v('warning'), soft: v('warning-soft'), text: v('warning-text') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft'), text: v('danger-text') },
        info: v('info'),
        peach: { DEFAULT: v('peach'), text: v('peach-text') },
        sky: { DEFAULT: v('sky'), text: v('sky-text') },
        sun: { DEFAULT: v('sun'), text: v('sun-text') },
        chip: {
          appt: '#eef0ff',
          'appt-text': '#3730a3',
          claim: '#fef3c7',
          'claim-text': '#92400e',
          renewal: '#ccfbf1',
          'renewal-text': '#115e59',
        },
      },
      fontFamily: {
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        heading: ['var(--font-heading)', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        btn: 'var(--radius-btn)',
        card: 'var(--radius-card)',
        hero: 'var(--radius-hero)',
      },
    },
  },
  plugins: [],
} satisfies Config;
