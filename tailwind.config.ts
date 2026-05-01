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
        body: ['"IBM Plex Sans Arabic"', 'sans-serif'],
        headline: ['"IBM Plex Sans Arabic"', 'sans-serif'],
        code: ['monospace'],
      },
      colors: {
        background: '#ECF2F9',
        foreground: '#1e293b',
        card: {
          DEFAULT: '#FFFFFF',
          foreground: '#1e293b',
        },
        popover: {
          DEFAULT: '#FFFFFF',
          foreground: '#1e293b',
        },
        primary: {
          DEFAULT: '#2874D4',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: '#0B1F3A',
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
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: '#E2E8F0',
        input: '#E2E8F0',
        ring: '#2874D4',
        chart: {
          '1': '#2874D4',
          '2': '#20CBD5',
          '3': '#12A063',
          '4': '#0B1F3A',
          '5': '#64748b',
        },
        sidebar: {
          DEFAULT: '#0B1F3A',
          foreground: '#f8fafc',
          primary: '#2874D4',
          'primary-foreground': '#FFFFFF',
          accent: '#1e293b',
          'accent-foreground': '#f8fafc',
          border: '#1e293b',
          ring: '#2874D4',
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
