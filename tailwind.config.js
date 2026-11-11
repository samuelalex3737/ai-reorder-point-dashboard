/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#060a14", 900: "#0a0f1c", 850: "#0e1424", 800: "#121a2e", 700: "#1b2540", 600: "#283456" },
        baseline: "#F5A524",
        ai: "#2DD4BF",
        forecast: "#38BDF8",
        risk: "#F43F5E",
        mc: "#A78BFA",
        ok: "#34D399",
        watch: "#FBBF24",
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        glass: "inset 0 1px 0 0 rgba(255,255,255,0.06), 0 10px 30px -12px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};
