import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const testUrl = new URL(tauri.build.devUrl);
testUrl.port = String(Number(testUrl.port) + 10000);
export default defineConfig({
  testDir: "tests/ui",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: testUrl.origin,
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  outputDir: ".runtime/ui-results",
  reporter: "list",
  webServer: {
    command: `npm run web:dev -- --port ${testUrl.port} --strictPort`,
    url: testUrl.origin,
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
  },
});
