# =============================================================================
# TypeScript & Code Quality Check - مناقصتي
# =============================================================================

$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = Get-Location }
Set-Location $ProjectRoot

Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  TypeScript & Code Quality Check" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$failures = 0

# TypeScript check
Write-Host "1. TypeScript Type Check" -ForegroundColor Yellow
npm run typecheck
if ($LASTEXITCODE -ne 0) { $failures++ }

Write-Host ""

# ESLint
Write-Host "2. ESLint Code Analysis" -ForegroundColor Yellow
npm run lint
if ($LASTEXITCODE -ne 0) { $failures++ }

Write-Host ""

# Build check (light)
Write-Host "3. Build Verification" -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { $failures++ }

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
if ($failures -eq 0) {
    Write-Host "✓ All code quality checks passed!" -ForegroundColor Green
} else {
    Write-Host "✗ $failures check(s) failed" -ForegroundColor Red
}
exit $failures