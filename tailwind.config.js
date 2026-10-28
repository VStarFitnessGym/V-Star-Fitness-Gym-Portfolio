/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        gym: {
          yellow: '#FFDC00',
          yellowHover: '#E5C600',
          dark: '#0A0A0A',
          charcoal: '#141414',
          card: '#1A1A1A',
          cardHover: '#222222',
          border: '#2A2A2A',
          muted: '#8E8E93',
          lightBg: '#EFEFEF',
          lightCard: '#FFFFFF',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Impact', 'Haettenschweiler', "'Arial Black'", 'sans-serif'],
        brand: ['Knewave', 'cursive'],
      }
    },
  },
  plugins: [],
}
