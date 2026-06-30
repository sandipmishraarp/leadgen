import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17202a",
        line: "#dbe3ea",
        accent: "#0f766e",
        amber: "#b7791f"
      }
    }
  },
  plugins: []
};

export default config;
