import defaultTheme from 'tailwindcss/defaultTheme'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
        mono: ['JetBrains Mono', ...defaultTheme.fontFamily.mono],
      },
      colors: {
        bg: '#FAFAF7',
        ink: '#0E0F0C',
      },
      boxShadow: {
        card: '0 1px 2px rgba(14,15,12,0.04), 0 8px 24px rgba(14,15,12,0.06)',
      },
    },
  },
  plugins: [],
}
