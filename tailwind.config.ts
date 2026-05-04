import type {Config} from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        body: ['var(--font-body)', 'sans-serif'],
        headline: ['var(--font-headline)', 'sans-serif'],
        code: ['monospace'],
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
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
