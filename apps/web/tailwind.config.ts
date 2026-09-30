import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'IRANYekanX', 'Tahoma', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#ff9500',
          dark: '#e67e00',
        },
      },
    },
  },
  plugins: [],
};
export default config;
