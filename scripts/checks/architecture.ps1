# =============================================================================
# Architecture Check - مناقصتي
# =============================================================================
# Verifies architectural best practices and patterns

$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = Get-Location }
Set-Location $ProjectRoot

Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Architecture Check - مناقصتي" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$failures = 0
$warnings = 0

# 1. Project Structure
Write-Host "1. Project Structure" -ForegroundColor Yellow

$requiredDirs = @(
    "src/app",
    "src/components",
    "src/components/ui",
    "src/components/layout",
    "src/firebase",
    "src/firebase/firestore",
    "src/hooks",
    "src/lib",
    "src/ai"
)

$missingDirs = @()
foreach ($dir in $requiredDirs) {
    if (-not (Test-Path $dir)) {
        $missingDirs += $dir
    }
}

if ($missingDirs.Count -eq 0) {
    Write-Host "✓ All required directories present" -ForegroundColor Green
} else {
    Write-Host "⚠️  Missing directories: $($missingDirs -join ', ')" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 2. Firebase Setup
Write-Host "2. Firebase Architecture" -ForegroundColor Yellow

$firebaseFiles = @(
    "src/firebase/config.ts",
    "src/firebase/provider.tsx",
    "src/firebase/client-provider.tsx",
    "src/firebase/index.ts"
)

$firebaseMissing = @()
foreach ($file in $firebaseFiles) {
    if (-not (Test-Path $file)) {
        $firebaseMissing += $file
    }
}

if ($firebaseMissing.Count -eq 0) {
    Write-Host "✓ Firebase setup complete" -ForegroundColor Green
} else {
    Write-Host "⚠️  Missing Firebase files: $($firebaseMissing -join ', ')" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 3. Firestore Hooks
Write-Host "3. Firestore Hooks" -ForegroundColor Yellow

$hooks = @(
    "src/firebase/firestore/use-collection.tsx",
    "src/firebase/firestore/use-doc.tsx"
)

$hooksMissing = @()
foreach ($hook in $hooks) {
    if (-not (Test-Path $hook)) {
        $hooksMissing += $hook
    }
}

if ($hooksMissing.Count -eq 0) {
    Write-Host "✓ Firestore hooks present" -ForegroundColor Green
} else {
    Write-Host "⚠️  Missing hooks: $($hooksMissing -join ', ')" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 4. Route Groups
Write-Host "4. Route Structure" -ForegroundColor Yellow

$routeGroups = @(
    "src/app/(admin)",
    "src/app/(contractor)",
    "src/app/(supplier)"
)

$routesMissing = @()
foreach ($route in $routeGroups) {
    if (-not (Test-Path $route)) {
        $routesMissing += $route
    }
}

if ($routesMissing.Count -eq 0) {
    Write-Host "✓ Role-based route groups present" -ForegroundColor Green
} else {
    Write-Host "⚠️  Missing route groups: $($routesMissing -join ', ')" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 5. Error Handling
Write-Host "5. Error Handling" -ForegroundColor Yellow

$errorFiles = @(
    "src/firebase/errors.ts",
    "src/firebase/error-emitter.ts"
)

$errorMissing = @()
foreach ($file in $errorFiles) {
    if (-not (Test-Path $file)) {
        $errorMissing += $file
    }
}

if ($errorMissing.Count -eq 0) {
    Write-Host "✓ Error handling system present" -ForegroundColor Green
} else {
    Write-Host "⚠️  Missing error handling: $($errorMissing -join ', ')" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 6. AI/Genkit Setup
Write-Host "6. AI Architecture" -ForegroundColor Yellow

if (Test-Path "src/ai") {
    Write-Host "✓ AI directory present" -ForegroundColor Green
    
    $aiFlows = Get-ChildItem "src/ai/flows" -ErrorAction SilentlyContinue
    if ($aiFlows) {
        Write-Host "  Found $($aiFlows.Count) AI flow(s)" -ForegroundColor Gray
    }
} else {
    Write-Host "⚠️  AI directory not found" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 7. Documentation Check
Write-Host "7. Documentation" -ForegroundColor Yellow

$docs = @(
    "docs/blueprint.md",
    "docs/backend.json"
)

$docsMissing = @()
foreach ($doc in $docs) {
    if (-not (Test-Path $doc)) {
        $docsMissing += $doc
    }
}

if ($docsMissing.Count -eq 0) {
    Write-Host "✓ Core documentation present" -ForegroundColor Green
} else {
    Write-Host "⚠️  Missing docs: $($docsMissing -join ', ')" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 8. Config Files
Write-Host "8. Configuration Files" -ForegroundColor Yellow

$configs = @(
    "tsconfig.json",
    "package.json",
    "tailwind.config.ts",
    "firestore.rules",
    "firebase.json"
)

$configMissing = @()
foreach ($config in $configs) {
    if (-not (Test-Path $config)) {
        $configMissing += $config
    }
}

if ($configMissing.Count -eq 0) {
    Write-Host "✓ All config files present" -ForegroundColor Green
} else {
    Write-Host "⚠️  Missing configs: $($configMissing -join ', ')" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 9. Test Setup
Write-Host "9. Testing Infrastructure" -ForegroundColor Yellow

$testConfigs = @(
    "jest.config.ts",
    "playwright.config.ts",
    "e2e"
)

$testMissing = @()
foreach ($test in $testConfigs) {
    if (-not (Test-Path $test)) {
        $testMissing += $test
    }
}

if ($testMissing.Count -eq 0) {
    Write-Host "✓ Testing infrastructure complete" -ForegroundColor Green
} else {
    Write-Host "⚠️  Missing test setup: $($testMissing -join ', ')" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 10. Database Schema
Write-Host "10. Backend Schema" -ForegroundColor Yellow

if (Test-Path "docs/backend.json") {
    $backendJson = Get-Content "docs/backend.json" -Raw | ConvertFrom-Json
    
    if ($backendJson.entities) {
        Write-Host "✓ Backend entities defined" -ForegroundColor Green
        Write-Host "  Entities: $($backendJson.entities.PSObject.Properties.Name -join ', ')" -ForegroundColor Gray
    }
} else {
    Write-Host "⚠️  No backend.json schema found" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Architecture Check Summary" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan

if ($failures -eq 0 -and $warnings -eq 0) {
    Write-Host "✓ All architecture checks passed!" -ForegroundColor Green
} elseif ($failures -eq 0) {
    Write-Host "⚠️  $warnings warning(s) - review for improvements" -ForegroundColor Yellow
} else {
    Write-Host "✗ $failures failure(s), $warnings warning(s)" -ForegroundColor Red
}

exit $failures