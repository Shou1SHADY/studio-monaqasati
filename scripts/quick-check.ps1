# =============================================================================
# Quick App Check - مناقصتي (PowerShell)
# =============================================================================
# Fast checks: TypeScript + ESLint only
# Use this for quick feedback during development
# =============================================================================

$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = Get-Location }
Set-Location $ProjectRoot

Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  مناقصتي - Quick Check (TypeScript + ESLint)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$failures = 0

# TypeScript
Write-Host "Running TypeScript check..." -ForegroundColor Yellow
npm run typecheck 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ TypeScript OK" -ForegroundColor Green
} else {
    Write-Host "✗ TypeScript errors found" -ForegroundColor Red
    $failures++
}

# ESLint
Write-Host "Running ESLint..." -ForegroundColor Yellow
npm run lint 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ ESLint OK" -ForegroundColor Green
} else {
    Write-Host "✗ ESLint issues found" -ForegroundColor Red
    $failures++
}

Write-Host ""
if ($failures -eq 0) {
    Write-Host "🎉 Quick check passed!" -ForegroundColor Green
} else {
    Write-Host "⚠️  $failures issue(s) - run full check for details" -ForegroundColor Yellow
}
exit $failures