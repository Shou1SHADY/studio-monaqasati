import type {Config} from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

export default {
  darkMode: ['class'],
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // 'Saudi Riyal Sign' leads every stack: it holds ONE glyph (U+20C1) and
      // its @font-face in globals.css is limited to that code point, so it
      // never competes with Noto/Inter for anything else.
      fontFamily: {
        body: ['Saudi Riyal Sign', 'var(--font-body)', 'sans-serif'],
        headline: ['Saudi Riyal Sign', 'var(--font-headline)', 'sans-serif'],
        code: ['Saudi Riyal Sign', 'monospace'],
        sans: ['Saudi Riyal Sign', ...defaultTheme.fontFamily.sans],
        mono: ['Saudi Riyal Sign', ...defaultTheme.fontFamily.mono],
      },
      colors: {
        background: '#F8FAFC',
        foreground: '#020617',
        card: {
          DEFAULT: '#FFFFFF',
          foreground: '#020617',
        },
        popover: {
          DEFAULT: '#FFFFFF',
          foreground: '#020617',
        },
        primary: {
          DEFAULT: '#0F172A',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: '#334155',
          foreground: '#FFFFFF',
        },
        muted: {
          DEFAULT: '#f1f5f9',
          foreground: '#64748b',
        },
        accent: {
          DEFAULT: '#20CBD5',
          foreground: '#FFFFFF',
        },
        success: {
          DEFAULT: '#12A063',
          foreground: '#FFFFFF',
        },
        cta: {
          DEFAULT: '#0369A1',
          foreground: '#FFFFFF',
        },
        warning: {
          DEFAULT: '#B45309',
          foreground: '#FFFFFF',
        },
        // Two more identities so no two modules share a colour (Sales, HR).
        // Extending keeps Tailwind's indigo-*/violet-* scales intact.
        indigo: {
          DEFAULT: '#4F46E5',
          foreground: '#FFFFFF',
        },
        violet: {
          DEFAULT: '#7C3AED',
          foreground: '#FFFFFF',
        },
        // The ACTIVE module's own colour. `--module` is set by data-accent on the
        // portal frame (globals.css), so `bg-module/10 text-module` inside any
        // screen is that module's colour without per-screen wiring. `on-dark`
        // is the same colour except where it would vanish on the navy sidebar.
        module: {
          DEFAULT: 'hsl(var(--module) / <alpha-value>)',
          foreground: 'hsl(var(--module-foreground) / <alpha-value>)',
          'on-dark': 'hsl(var(--module-on-dark) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: '#E2E8F0',
        input: '#E2E8F0',
        ring: '#0F172A',
        chart: {
          '1': '#0F172A',
          '2': '#0369A1',
          '3': '#12A063',
          '4': '#334155',
          '5': '#64748b',
        },
        sidebar: {
          DEFAULT: '#0F172A',
          foreground: '#f8fafc',
          primary: '#0369A1',
          'primary-foreground': '#FFFFFF',
          accent: '#1e293b',
          'accent-foreground': '#f8fafc',
          border: '#1e293b',
          ring: '#0F172A',
        },
      },
      borderRadius: {
        lg: '12px',
        md: '10px',
        sm: '8px',
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
      transitionDuration: {
        '1500': '1500ms',
        '3000': '3000ms',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
