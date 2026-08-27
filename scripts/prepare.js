// scripts/prepare.js
//
// Runs on every `npm install` (npm's `prepare` hook). Its only job is to put
// Playwright's browsers on a developer's machine for the e2e suite. Those
// browsers are never needed to BUILD the app, so on any hosted build — Vercel,
// Firebase App Hosting (Cloud Build), GitHub Actions — this must do nothing.
// It also must never fail the install: a missing browser is a local
// inconvenience, not a reason for a deploy to die.
const isHostedBuild =
  process.env.VERCEL ||
  process.env.CI ||
  process.env.FIREBASE_CONFIG ||        // Firebase App Hosting build/runtime
  process.env.K_SERVICE ||              // Cloud Run
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD

if (isHostedBuild) {
  console.log('prepare: hosted build detected — skipping Playwright browser install')
} else {
  const { execSync } = require('child_process')
  console.log('prepare: installing Playwright browsers for local e2e tests...')
  try {
    execSync('npx playwright install --with-deps', { stdio: 'inherit' })
  } catch (err) {
    console.warn('prepare: Playwright install failed (e2e tests will need `npx playwright install`):', err.message)
  }
}
