import { defineConfig } from "@playwright/test";

export default defineConfig({
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5397",
    launchOptions: { executablePath: process.env.CHROMIUM_PATH },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5397 --strictPort",
    cwd: "..",
    url: "http://127.0.0.1:5397",
    env: { VITE_SUPABASE_URL: "http://127.0.0.1:5398", VITE_SUPABASE_ANON_KEY: "test" },
  },
});
