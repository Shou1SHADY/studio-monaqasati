# =============================================================================
# Git Hooks Setup - مناقصتي
# =============================================================================
# Installs and configures Git hooks for automatic validation
# =============================================================================

$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = Get-Location }
Set-Location $ProjectRoot

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  مناقصتي - Git Hooks Setup" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$HooksDir = ".git/hooks"

# Create hooks directory if needed
if (-not (Test-Path $HooksDir)) {
    New-Item -ItemType Directory -Path $HooksDir -Force | Out-Null
}

# Copy hooks from .ps1 versions
Write-Host "Installing hooks..." -ForegroundColor Yellow

# Pre-commit hook
Copy-Item -Path "pre-commit.ps1" -Destination "$HooksDir/pre-commit" -Force -ErrorAction SilentlyContinue
Write-Host "  ✓ pre-commit" -ForegroundColor Green

# Post-commit hook
Copy-Item -Path "post-commit.ps1" -Destination "$HooksDir/post-commit" -Force -ErrorAction SilentlyContinue
Write-Host "  ✓ post-commit" -ForegroundColor Green

# Make hooks executable (Unix-like systems)
if (Get-Command chmod -ErrorAction SilentlyContinue) {
    chmod +x "$HooksDir/pre-commit" 2>$null
    chmod +x "$HooksDir/post-commit" 2>$null
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Hooks installed!" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "Available hooks:" -ForegroundColor Cyan
Write-Host "  pre-commit  - Runs validation before each commit" -ForegroundColor Gray
Write-Host "  post-commit - Shows status after each commit" -ForegroundColor Gray

Write-Host ""
Write-Host "To manually run validation:" -ForegroundColor Cyan
Write-Host "  npm run check:quick     - Quick check" -ForegroundColor Gray
Write-Host "  npm run validate        - Full validation" -ForegroundColor Gray

Write-Host ""
Write-Host "To bypass pre-commit (not recommended):" -ForegroundColor Cyan
Write-Host "  git commit --no-verify" -ForegroundColor Gray

Write-Host ""