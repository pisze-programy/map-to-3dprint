// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const isMac = process.platform === 'darwin';
const glFlags = isMac
  ? ['--use-gl=angle', '--use-angle=metal']
  : ['--use-gl=angle', '--use-angle=swiftshader'];

/**
 * Playwright E2E configuration for map-to-3dprint
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.js$/,
  timeout: 90000,
  expect: {
    timeout: 30000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,

  webServer: {
    command: 'python3 server.py',
    port: 8765,
    reuseExistingServer: true,
    timeout: 10000,
  },

  use: {
    baseURL: 'http://127.0.0.1:8765',
    ...devices['Desktop Chrome'],
    channel: 'chromium',
    headless: true,
    launchOptions: {
      args: [
        ...glFlags,
        '--enable-webgl',
        '--enable-webgl2-compute-context',
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    },
  },

  reporter: [
    ['list'],
    ['json', { outputFile: 'tests/e2e/reports/test_results.json' }],
  ],
});
