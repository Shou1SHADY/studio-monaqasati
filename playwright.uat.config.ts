import { existsSync } from 'fs'
import { defineConfig, devices } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL || 'https://studio-monaqasati--mdmaktech-uat.us-east4.hosted.app'

const stateFile = (name: string) => {
  const p = process.env[name]
  return p && existsSync(p) ? p : undefined
}

export default defineConfig({
  testDir: './e2e/live',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-live' }]],
  use: { baseURL: BASE, trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 20_000 },
  projects: [
    { name: 'public', testMatch: /public\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'supplier', testMatch: /supplier-free\.spec\.ts/, use: { ...devices['Desktop Chrome'], storageState: stateFile('E2E_SUPPLIER_STATE') } },
    { name: 'admin', testMatch: /admin-finance\.spec\.ts/, use: { ...devices['Desktop Chrome'], storageState: stateFile('E2E_ADMIN_STATE') } },
  ],
})
