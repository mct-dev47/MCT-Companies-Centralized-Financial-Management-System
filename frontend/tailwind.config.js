/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#960C01',
          foreground: '#FFFFFF',
          tint: 'rgb(150 12 1 / 0.2)',
        },
        background: 'var(--background)',
        focus: '#0B0F2B',
        error: {
          DEFAULT: '#960C01',
          foreground: '#FFFFFF',
        },
        disabled: {
          DEFAULT: '#767B89',
          foreground: '#FFFFFF',
        },
        stroke: '#979797',
        surface: '#F4F4F4',
        'muted-fg': '#767B89',
        'chart-neutral': 'rgb(151 151 151 / 0.6)',
        'icon-tile': '#E5E5E5',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'InterVariable', 'Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        heading: ['clamp(2.5rem, 3.33vw, 4rem)', { lineHeight: '1.1' }],
        subheading: ['clamp(2rem, 2.5vw, 3rem)', { lineHeight: '1.2' }],
        'page-title': ['clamp(1.75rem, 2.08vw, 2.5rem)', { lineHeight: '1.2' }],
        'banner-title': ['clamp(1.75rem, 2.08vw, 2.5rem)', { lineHeight: '1.2' }],
        'kpi-value': ['clamp(1.5rem, 1.875vw, 2.25rem)', { lineHeight: '1.2' }],
        'card-title': ['clamp(1.125rem, 1.04vw, 1.25rem)', { lineHeight: '1.3' }],
        body: ['clamp(1rem, 1.04vw, 1.25rem)', { lineHeight: '1.4' }],
        label: ['1rem', { lineHeight: '1.25' }],
        caption: ['0.875rem', { lineHeight: '1.3' }],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'sphere-float-1': {
          '0%, 100%': {
            transform: 'translate3d(0px, 0px, 0px) scale(1) rotate(0deg)',
          },
          '25%': {
            transform: 'translate3d(24px, -26px, 0px) scale(1.06) rotate(4deg)',
          },
          '50%': {
            transform: 'translate3d(-20px, 18px, 0px) scale(0.95) rotate(-3deg)',
          },
          '75%': {
            transform: 'translate3d(18px, 24px, 0px) scale(1.04) rotate(2deg)',
          },
        },
        'sphere-float-2': {
          '0%, 100%': {
            transform: 'translate3d(0px, 0px, 0px) scale(1) rotate(0deg)',
          },
          '30%': {
            transform: 'translate3d(32px, 28px, 0px) scale(1.05) rotate(-5deg)',
          },
          '60%': {
            transform: 'translate3d(-24px, 36px, 0px) scale(0.96) rotate(3deg)',
          },
          '85%': {
            transform: 'translate3d(18px, -20px, 0px) scale(1.03) rotate(-2deg)',
          },
        },
        'sphere-float-3': {
          '0%, 100%': {
            transform: 'translate3d(0px, 0px, 0px) scale(1) rotate(0deg)',
          },
          '20%': {
            transform: 'translate3d(-28px, -24px, 0px) scale(1.05) rotate(3deg)',
          },
          '50%': {
            transform: 'translate3d(28px, -32px, 0px) scale(0.95) rotate(-4deg)',
          },
          '75%': {
            transform: 'translate3d(-18px, 22px, 0px) scale(1.02) rotate(2deg)',
          },
        },
        'sphere-float-accent': {
          '0%, 100%': {
            transform: 'translate3d(0px, 0px, 0px) scale(0.96)',
          },
          '35%': {
            transform: 'translate3d(-22px, 26px, 0px) scale(1.08)',
          },
          '70%': {
            transform: 'translate3d(24px, -20px, 0px) scale(1.02)',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'sphere-float-1': 'sphere-float-1 6s ease-in-out infinite',
        'sphere-float-2': 'sphere-float-2 8s ease-in-out infinite',
        'sphere-float-3': 'sphere-float-3 7s ease-in-out infinite',
        'sphere-float-accent': 'sphere-float-accent 5s ease-in-out infinite',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
  ],
}
