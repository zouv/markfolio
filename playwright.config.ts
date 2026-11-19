import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
export default defineConfig({
  testDir: "tests/ui",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: tauri.build.devUrl,
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  outputDir: ".runtime/ui-results",
  reporter: "list",
  webServer: {
    command: "npm run web:dev",
    url: tauri.build.devUrl,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
