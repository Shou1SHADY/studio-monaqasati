// scripts/prepare.js
// Cross-platform prepare script: skip Playwright browser install on Vercel
if (process.env.VERCEL) {
  console.log('Skipping Playwright install on Vercel (VERCEL environment detected)')
} else {
  const { execSync } = require('child_process')
  console.log('Installing Playwright browsers and dependencies...')
  try {
    execSync('npx playwright install --with-deps', { stdio: 'inherit' })
  } catch (err) {
    console.error('Playwright install failed:', err.message)
    process.exit(1)
  }
}
