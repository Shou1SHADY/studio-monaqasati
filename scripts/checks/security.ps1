# =============================================================================
# Security Check - مدماك تيك
# =============================================================================

$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = Get-Location }
Set-Location $ProjectRoot

Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Security Check - مدماك تيك" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$failures = 0

# 1. NPM Audit
Write-Host "1. NPM Vulnerability Audit" -ForegroundColor Yellow
npm audit --audit-level=medium
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Vulnerabilities found - review output above" -ForegroundColor Yellow
}

Write-Host ""

# 2. Check for exposed secrets in code
Write-Host "2. Secret Exposure Check" -ForegroundColor Yellow

$secretPatterns = @(
    "apiKey.*=.*['\"][a-zA-Z0-9]{20,}['\"]",
    "password.*=.*['\"][^'\"]{8,}['\"]",
    "secret.*=.*['\"][a-zA-Z0-9]{20,}['\"]",
    "token.*=.*['\"][a-zA-Z0-9]{20,}['\"]"
)

$exposedSecrets = @()
$srcFiles = Get-ChildItem -Path "src" -Recurse -Include "*.ts","*.tsx" -Exclude "node_modules"

foreach ($file in $srcFiles) {
    $content = Get-Content $file.FullName -Raw
    foreach ($pattern in $secretPatterns) {
        if ($content -match $pattern) {
            $exposedSecrets += "$($file.Name): potential $pattern"
        }
    }
}

if ($exposedSecrets.Count -eq 0) {
    Write-Host "✓ No obvious secret exposures found" -ForegroundColor Green
} else {
    Write-Host "⚠️  Potential secrets found:" -ForegroundColor Yellow
    $exposedSecrets | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    $failures++
}

Write-Host ""

# 3. Check .env files
Write-Host "3. Environment File Check" -ForegroundColor Yellow

if (Test-Path ".env.local") {
    $envContent = Get-Content ".env.local" -Raw
    if ($envContent -match "YOUR_API_KEY|placeholder|example\.com") {
        Write-Host "⚠️  .env.local contains placeholder values" -ForegroundColor Yellow
    } else {
        Write-Host "✓ .env.local looks properly configured" -ForegroundColor Green
    }
}

if (Test-Path ".env") {
    Write-Host "⚠️  Found .env file (should be in .gitignore)" -ForegroundColor Yellow
    $failures++
}

if (Test-Path ".env.local.example") {
    Write-Host "✓ Found .env.local.example template" -ForegroundColor Green
}

Write-Host ""

# 4. Check Firebase rules
Write-Host "4. Firebase Security Rules" -ForegroundColor Yellow

if (Test-Path "firestore.rules") {
    $rulesContent = Get-Content "firestore.rules" -Raw
    
    if ($rulesContent -match "allow read, write: if true") {
        Write-Host "⚠️  Found overly permissive rules (allow *, write: if true)" -ForegroundColor Yellow
        $failures++
    } else {
        Write-Host "✓ Firestore rules look properly configured" -ForegroundColor Green
    }
} else {
    Write-Host "⚠️  No firestore.rules found" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
if ($failures -eq 0) {
    Write-Host "✓ Security checks passed!" -ForegroundColor Green
} else {
    Write-Host "⚠️  $failures security concern(s) found" -ForegroundColor Yellow
}
exit $failures