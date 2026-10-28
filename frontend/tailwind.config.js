/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        mc: {
          dark: '#121214',
          card: '#1a1a1e',
          accent: '#22c55e',
          red: '#ef4444',
          border: '#2a2a30'
        }
      }
    },
  },
  plugins: [],
}
