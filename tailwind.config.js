/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",  // 扫描 pages 目录中的所有文件
    "./components/**/*.{js,ts,jsx,tsx}",  // 扫描 components 目录中的所有文件
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
