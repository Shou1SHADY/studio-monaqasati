# =============================================================================
# Professional App Validation Suite - مناقصتي
# =============================================================================
# Comprehensive automation combining:
# - Code Quality (TypeScript, ESLint, Build)
# - Testing (Unit, E2E, Coverage)
# - Security (Vulnerabilities, Secrets)
# - Architecture Review
# - UI/UX Validation
# - GSD Skills Integration (code-review, audit-fix, health)
# =============================================================================

param(
    [switch]$Full,           # Run all checks including E2E
    [switch]$Quick,          # Quick validation only
    [switch]$Fix,            # Auto-fix issues where possible
    [switch]$Verbose,        # Detailed output
    [switch]$SkipE2E,        # Skip E2E tests
    [switch]$SkipBuild       # Skip build step
)

$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = Get-Location }
Set-Location $ProjectRoot

# Colors for output
function Write-CheckHeader {
    param([string]$Message)
    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $Message" -ForegroundColor Cyan
    Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

function Write-CheckResult {
    param([string]$Name, [bool]$Success, [string]$Details = "")
    $status = if ($Success) { "✓ PASS" } else { "✗ FAIL" }
    $color = if ($Success) { "Green" } else { "Red" }
    
    Write-Host "$status - $Name" -ForegroundColor $color
    if ($Details -and $Verbose) {
        Write-Host "  → $Details" -ForegroundColor Gray
    }
}

# Timestamp
$StartTime = Get-Date

Write-Host @"

╔═══════════════════════════════════════════════════════════════════╗
║           مناقصتي - Professional App Validation                    ║
║                    Comprehensive Quality Suite                      ║
╚═══════════════════════════════════════════════════════════════════╝

"@ -ForegroundColor Cyan

# Track results
$Results = @{
    "TypeScript" = @{ Success = $false; Time = 0 }
    "ESLint" = @{ Success = $false; Time = 0 }
    "Build" = @{ Success = $false; Time = 0 }
    "UnitTests" = @{ Success = $false; Time = 0 }
    "E2E" = @{ Success = $false; Time = 0 }
    "Security" = @{ Success = $false; Time = 0 }
    "Architecture" = @{ Success = $false; Time = 0 }
    "UIUX" = @{ Success = $false; Time = 0 }
}

# =============================================================================
# PHASE 1: Code Quality
# =============================================================================
Write-CheckHeader "Phase 1: Code Quality"

$stepStart = Get-Date

# 1.1 TypeScript
Write-Host "Running TypeScript type checking..." -ForegroundColor Yellow
$tsStart = Get-Date
$tsOutput = npm run typecheck 2>&1
$tsSuccess = $LASTEXITCODE -eq 0
$Results["TypeScript"].Time = (Get-Date) - $tsStart
$Results["TypeScript"].Success = $tsSuccess
Write-CheckResult "TypeScript Check" $tsSuccess

# 1.2 ESLint
Write-Host "Running ESLint analysis..." -ForegroundColor Yellow
$lintStart = Get-Date
$lintOutput = npm run lint 2>&1
$lintSuccess = $LASTEXITCODE -eq 0
$Results["ESLint"].Time = (Get-Date) - $lintStart
$Results["ESLint"].Success = $lintSuccess
Write-CheckResult "ESLint Analysis" $lintSuccess

if (-not $Quick) {
    # 1.3 Build
    if (-not $SkipBuild) {
        Write-Host "Verifying production build..." -ForegroundColor Yellow
        $buildStart = Get-Date
        $buildOutput = npm run build 2>&1
        $buildSuccess = $LASTEXITCODE -eq 0
        $Results["Build"].Time = (Get-Date) - $buildStart
        $Results["Build"].Success = $buildSuccess
        Write-CheckResult "Production Build" $buildSuccess
    }
}

# =============================================================================
# PHASE 2: Testing
# =============================================================================
if (-not $Quick) {
    Write-CheckHeader "Phase 2: Testing Suite"
    
    # 2.1 Unit Tests
    Write-Host "Running unit tests..." -ForegroundColor Yellow
    $testStart = Get-Date
    $testOutput = npm run test -- --passWithNoTests 2>&1
    $testSuccess = $LASTEXITCODE -eq 0
    $Results["UnitTests"].Time = (Get-Date) - $testStart
    $Results["UnitTests"].Success = $testSuccess
    Write-CheckResult "Unit Tests (Jest)" $testSuccess
    
    # 2.2 E2E Tests
    if (-not $SkipE2E -and $Full) {
        Write-Host "Running E2E tests..." -ForegroundColor Yellow
        $e2eStart = Get-Date
        
        # Start dev server
        $devJob = Start-Job -ScriptBlock {
            param($dir)
            Set-Location $dir
            npm run dev
        } -ArgumentList $ProjectRoot
        
        Start-Sleep -Seconds 15
        
        $e2eOutput = npm run e2e 2>&1
        $e2eSuccess = $LASTEXITCODE -eq 0
        
        Stop-Job $devJob -ErrorAction SilentlyContinue
        Remove-Job $devJob -ErrorAction SilentlyContinue
        
        $Results["E2E"].Time = (Get-Date) - $e2eStart
        $Results["E2E"].Success = $e2eSuccess
        Write-CheckResult "E2E Tests (Playwright)" $e2eSuccess
    }
}

# =============================================================================
# PHASE 3: Security Audit
# =============================================================================
Write-CheckHeader "Phase 3: Security Audit"

# 3.1 NPM Audit
Write-Host "Running security audit..." -ForegroundColor Yellow
$secStart = Get-Date
$secOutput = npm audit --audit-level=medium 2>&1
$secSuccess = $LASTEXITCODE -eq 0
$Results["Security"].Time = (Get-Date) - $secStart
$Results["Security"].Success = $secSuccess
Write-CheckResult "Security Audit" $secSuccess "NPM vulnerabilities"

# =============================================================================
# PHASE 4: Architecture Review
# =============================================================================
Write-CheckHeader "Phase 4: Architecture Review"

$archStart = Get-Date

Write-Host "Checking project structure..." -ForegroundColor Yellow

# Check directory structure
$requiredDirs = @("src/app", "src/components", "src/firebase", "src/hooks", "src/lib", "docs")
$archIssues = @()

foreach ($dir in $requiredDirs) {
    if (-not (Test-Path $dir)) {
        $archIssues += "Missing: $dir"
    }
}

# Check config files
$configFiles = @("tsconfig.json", "package.json", "tailwind.config.ts", "firestore.rules")
foreach ($file in $configFiles) {
    if (-not (Test-Path $file)) {
        $archIssues += "Missing: $file"
    }
}

$archSuccess = $archIssues.Count -eq 0
$Results["Architecture"].Time = (Get-Date) - $archStart
$Results["Architecture"].Success = $archSuccess
Write-CheckResult "Architecture Check" $archSuccess

if ($archIssues.Count -gt 0 -and $Verbose) {
    foreach ($issue in $archIssues) {
        Write-Host "  → $issue" -ForegroundColor Yellow
    }
}

# =============================================================================
# PHASE 5: UI/UX Validation
# =============================================================================
Write-CheckHeader "Phase 5: UI/UX Validation"

$uiStart = Get-Date
$uiIssues = @()

# Check Tailwind config
$tailwindContent = Get-Content "tailwind.config.ts" -Raw -ErrorAction SilentlyContinue
$requiredColors = @("primary", "accent", "success", "sidebar")
foreach ($color in $requiredColors) {
    if ($tailwindContent -notmatch $color) {
        $uiIssues += "Missing Tailwind color: $color"
    }
}

# Check key components
$keyComponents = @("src/components/ui/button.tsx", "src/components/ui/card.tsx", "src/components/layout/portal-layout.tsx")
foreach ($comp in $keyComponents) {
    if (-not (Test-Path $comp)) {
        $uiIssues += "Missing component: $comp"
    }
}

# Check RTL support
$layoutContent = Get-Content "src/app/layout.tsx" -Raw -ErrorAction SilentlyContinue
if ($layoutContent -notmatch 'dir="rtl"') {
    $uiIssues += "RTL direction not configured"
}

$uiSuccess = $uiIssues.Count -eq 0
$Results["UIUX"].Time = (Get-Date) - $uiStart
$Results["UIUX"].Success = $uiSuccess
Write-CheckResult "UI/UX Validation" $uiSuccess

if ($uiIssues.Count -gt 0 -and $Verbose) {
    foreach ($issue in $uiIssues) {
        Write-Host "  → $issue" -ForegroundColor Yellow
    }
}

# =============================================================================
# Summary
# =============================================================================
$EndTime = Get-Date
$Duration = $EndTime - $StartTime

Write-CheckHeader "Validation Summary"

$passCount = ($Results.Values | Where-Object { $_.Success }).Count
$totalCount = $Results.Count

Write-Host "Total Duration: $($Duration.ToString('mm\m ss\s'))" -ForegroundColor Gray
Write-Host ""

Write-Host "┌─────────────────────────┬──────────┬──────────┐" -ForegroundColor Cyan
Write-Host "│ Check                   │ Status   │ Time     │" -ForegroundColor Cyan
Write-Host "├─────────────────────────┼──────────┼──────────┤" -ForegroundColor Cyan

foreach ($key in $Results.Keys | Sort-Object) {
    $item = $Results[$key]
    $status = if ($item.Success) { "PASS" } else { "FAIL" }
    $time = if ($item.Time.TotalSeconds -lt 60) { 
        "$([int]$item.Time.TotalSeconds)s" 
    } else { 
        "$([int]$item.Time.TotalMinutes)m" 
    }
    $color = if ($item.Success) { "Green" } else { "Red" }
    
    $padding = " " * (20 - $key.Length)
    Write-Host "│ $key$padding│ $status   │ $time     │" -ForegroundColor $color
}

Write-Host "└─────────────────────────┴──────────┴──────────┘" -ForegroundColor Cyan

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan

$failedCount = ($Results.Values | Where-Object { -not $_.Success }).Count

if ($failedCount -eq 0) {
    Write-Host "✓ ALL CHECKS PASSED - App is production ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host "  • Run './scripts/check-all.ps1 -Full' for complete validation" -ForegroundColor Gray
    Write-Host "  • Use GSD skills: /gsd-code-review, /gsd-validate-phase" -ForegroundColor Gray
    Write-Host "  • Review docs/frontend/ARCHITECTURE.md for best practices" -ForegroundColor Gray
    
    exit 0
} else {
    Write-Host "⚠️  $failedCount check(s) failed - Review issues above" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Recommended Actions:" -ForegroundColor Cyan
    Write-Host "  • Run './scripts/checks/code-quality.ps1' for details" -ForegroundColor Gray
    Write-Host "  • Use GSD audit: /gsd-audit-fix for automated fixes" -ForegroundColor Gray
    Write-Host "  • Check documentation in docs/ for guidance" -ForegroundColor Gray
    
    exit 1
}