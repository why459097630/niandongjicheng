/** @type {import('tailwindcss').Config} */
module.exports = {
  // 扫描模板/组件文件，按你的目录结构增减即可
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  darkMode: "class", // 如不需要暗色模式可改为 'media' 或删除
  theme: {
    extend: {}
  },
  plugins: []
};
