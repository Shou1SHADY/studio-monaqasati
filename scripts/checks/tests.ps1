# =============================================================================
# Test Suite Check - مدماك تيك
# =============================================================================

param(
    [switch]$UnitOnly,
    [switch]$E2EOnly,
    [switch]$Coverage
)

$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = Get-Location }
Set-Location $ProjectRoot

Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Test Suite Check - مدماك تيك" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$failures = 0

# Unit Tests
if (-not $E2EOnly) {
    Write-Host "1. Unit Tests (Jest)" -ForegroundColor Yellow
    npm run test -- --passWithNoTests
    if ($LASTEXITCODE -ne 0) { $failures++ }
    
    if ($Coverage) {
        Write-Host ""
        Write-Host "2. Coverage Report" -ForegroundColor Yellow
        npm run test:coverage
        if ($LASTEXITCODE -ne 0) { $failures++ }
    }
}

# E2E Tests
if (-not $UnitOnly) {
    Write-Host ""
    Write-Host "3. End-to-End Tests (Playwright)" -ForegroundColor Yellow
    
    # Start dev server
    $devJob = Start-Job -ScriptBlock {
        param($dir)
        Set-Location $dir
        npm run dev
    } -ArgumentList $ProjectRoot
    
    Write-Host "Starting dev server..." -ForegroundColor Yellow
    Start-Sleep -Seconds 15
    
    npm run e2e
    $e2eResult = $LASTEXITCODE
    
    Stop-Job $devJob -ErrorAction SilentlyContinue
    Remove-Job $devJob -ErrorAction SilentlyContinue
    
    if ($e2eResult -ne 0) { $failures++ }
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
if ($failures -eq 0) {
    Write-Host "✓ All tests passed!" -ForegroundColor Green
} else {
    Write-Host "✗ $failures test(s) failed" -ForegroundColor Red
}
exit $failures