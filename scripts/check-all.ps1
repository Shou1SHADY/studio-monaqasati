# =============================================================================
# Comprehensive App Check Script - مناقصتي (PowerShell)
# =============================================================================
# This script runs all checks on the application:
# - TypeScript type checking
# - ESLint linting
# - Unit tests (Jest)
# - Build verification
# - Security checks
# =============================================================================

param(
    [switch]$SkipE2E,
    [switch]$SkipBuild,
    [switch]$Quick
)

$ErrorActionPreference = "Continue"

# Configuration
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = Get-Location }
Set-Location $ProjectRoot

# Colors
function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $Message" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Status {
    param([bool]$Success, [string]$Message)
    if ($Success) {
        Write-Host "✓ $Message" -ForegroundColor Green
    } else {
        Write-Host "✗ $Message" -ForegroundColor Red
    }
}

# Store start time
$StartTime = Get-Date

Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║          مناقصتي - Comprehensive App Check                      ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# Step 1: Check/Install Dependencies
# -----------------------------------------------------------------------------
Write-Header "Checking Dependencies"

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -eq 0) { Write-Status $true "Dependencies installed" }
    else { Write-Status $false "Failed to install dependencies"; exit 1 }
} else {
    Write-Status $true "Dependencies already installed"
}

# -----------------------------------------------------------------------------
# Step 2: TypeScript Type Checking
# -----------------------------------------------------------------------------
Write-Header "TypeScript Type Checking"

$typeCheck = 0
npm run typecheck 2>&1 | Tee-Object -Variable output | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Status $true "TypeScript type check passed" }
else { Write-Status $false "TypeScript type check failed"; $typeCheck = 1 }

# -----------------------------------------------------------------------------
# Step 3: ESLint
# -----------------------------------------------------------------------------
Write-Header "ESLint Code Quality"

$lint = 0
npm run lint 2>&1 | Tee-Object -Variable lintOutput | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Status $true "ESLint passed" }
else { Write-Status $false "ESLint found issues"; $lint = 1 }

if ($Quick) {
    Write-Host "`nQuick mode: Skipping build, tests, and E2E tests" -ForegroundColor Yellow
    goto Summary
}

# -----------------------------------------------------------------------------
# Step 4: Build Verification (unless skipped)
# -----------------------------------------------------------------------------
if (-not $SkipBuild) {
    Write-Header "Production Build"

    $build = 0
    npm run build 2>&1 | Tee-Object -Variable buildOutput | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Status $true "Build successful" }
    else { Write-Status $false "Build failed"; $build = 1 }
}

# -----------------------------------------------------------------------------
# Step 5: Unit Tests
# -----------------------------------------------------------------------------
Write-Header "Unit Tests (Jest)"

$test = 0
npm run test -- --passWithNoTests 2>&1 | Tee-Object -Variable testOutput | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Status $true "Unit tests passed" }
else { Write-Status $false "Unit tests failed"; $test = 1 }

# -----------------------------------------------------------------------------
# Step 6: Code Coverage
# -----------------------------------------------------------------------------
Write-Header "Test Coverage"

$coverage = 0
npm run test:coverage 2>&1 | Tee-Object -Variable coverageOutput | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Status $true "Coverage report generated" }
else { Write-Status $false "Coverage report failed"; $coverage = 1 }

# -----------------------------------------------------------------------------
# Step 7: E2E Tests (unless skipped)
# -----------------------------------------------------------------------------
if (-not $SkipE2E) {
    Write-Header "End-to-End Tests (Playwright)"

    # Start dev server in background
    $devJob = Start-Job -ScriptBlock {
        param($dir)
        Set-Location $dir
        npm run dev
    } -ArgumentList $ProjectRoot

    # Wait for server
    Write-Host "Waiting for dev server..." -ForegroundColor Yellow
    Start-Sleep -Seconds 15

    # Run E2E tests
    $e2e = 0
    npm run e2e 2>&1 | Tee-Object -Variable e2eOutput | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Status $true "E2E tests passed" }
    else { Write-Status $false "E2E tests failed"; $e2e = 1 }

    # Cleanup
    Stop-Job $devJob -ErrorAction SilentlyContinue
    Remove-Job $devJob -ErrorAction SilentlyContinue
}

# -----------------------------------------------------------------------------
# Step 8: Security Audit
# -----------------------------------------------------------------------------
Write-Header "Security Audit"

$security = 0
npm audit --audit-level=high 2>&1 | Tee-Object -Variable securityOutput | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Status $true "No high severity vulnerabilities" }
else { Write-Status $false "Security vulnerabilities found"; $security = 1 }

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
:Summary

$EndTime = Get-Date
$Duration = $EndTime - $StartTime

Write-Header "Summary"

Write-Host "Total time: $($Duration.ToString('mm\m ss\s'))"
Write-Host ""

$table = @"
┌─────────────────────────┬──────────┐
│ Check                   │ Status   │
├─────────────────────────┼──────────┤
│ TypeScript              │ $(if ($typeCheck -eq 0) { "PASS" } else { "FAIL" })      │
│ ESLint                  │ $(if ($lint -eq 0) { "PASS" } else { "FAIL" })      │
"@

if ($SkipBuild) {
    $table += "`n│ Build                   │ SKIPPED  │"
} else {
    $table += "`n│ Build                   │ $(if ($build -eq 0) { "PASS" } else { "FAIL" })      │"
}

$table += @"
│ Unit Tests              │ $(if ($test -eq 0) { "PASS" } else { "FAIL" })      │
│ Coverage                │ $(if ($coverage -eq 0) { "PASS" } else { "FAIL" })      │
"@

if ($SkipE2E) {
    $table += "`n│ E2E Tests               │ SKIPPED  │"
} else {
    $table += "`n│ E2E Tests               │ $(if ($e2e -eq 0) { "PASS" } else { "FAIL" })      │"
}

$table += @"
│ Security                │ $(if ($security -eq 0) { "PASS" } else { "FAIL" })      │
└─────────────────────────┴──────────┘
"@

Write-Host $table -ForegroundColor Cyan

$totalFailures = $typeCheck + $lint + $build + $test + $coverage + $e2e + $security

if ($totalFailures -eq 0) {
    Write-Host ""
    Write-Host "🎉 All checks passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host ""
    Write-Host "⚠️  $totalFailures check(s) failed. Please review." -ForegroundColor Red
    exit 1
}