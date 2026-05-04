# =============================================================================
# UI/UX Check - مناقصتي
# =============================================================================
# Verifies UI/UX best practices and design system compliance

$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = Get-Location }
Set-Location $ProjectRoot

Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  UI/UX Best Practices Check - مناقصتي" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$failures = 0
$warnings = 0

# 1. Tailwind Config Check
Write-Host "1. Tailwind Configuration" -ForegroundColor Yellow

if (Test-Path "tailwind.config.ts") {
    $tailwindContent = Get-Content "tailwind.config.ts" -Raw
    
    $requiredColors = @("primary", "accent", "success", "sidebar")
    $missingColors = @()
    
    foreach ($color in $requiredColors) {
        if ($tailwindContent -notmatch $color) {
            $missingColors += $color
        }
    }
    
    if ($missingColors.Count -eq 0) {
        Write-Host "✓ All required colors defined in Tailwind" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Missing colors: $($missingColors -join ', ')" -ForegroundColor Yellow
        $warnings++
    }
} else {
    Write-Host "✗ tailwind.config.ts not found" -ForegroundColor Red
    $failures++
}

Write-Host ""

# 2. Design System Components
Write-Host "2. Design System Components" -ForegroundColor Yellow

$uiComponents = @(
    "button.tsx",
    "card.tsx",
    "input.tsx",
    "dialog.tsx",
    "select.tsx",
    "table.tsx"
)

$missingComponents = @()
foreach ($comp in $uiComponents) {
    $found = Get-ChildItem -Path "src/components" -Recurse -Filter $comp -ErrorAction SilentlyContinue
    if (-not $found) {
        $missingComponents += $comp
    }
}

if ($missingComponents.Count -eq 0) {
    Write-Host "✓ All core UI components present" -ForegroundColor Green
} else {
    Write-Host "⚠️  Missing components: $($missingComponents -join ', ')" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 3. Layout Structure Check
Write-Host "3. Layout Structure" -ForegroundColor Yellow

$layoutFiles = @(
    "src/app/layout.tsx",
    "src/components/layout/portal-layout.tsx",
    "src/components/layout/role-sidebar.tsx"
)

$missingLayouts = @()
foreach ($layout in $layoutFiles) {
    if (-not (Test-Path $layout)) {
        $missingLayouts += $layout
    }
}

if ($missingLayouts.Count -eq 0) {
    Write-Host "✓ Layout components present" -ForegroundColor Green
} else {
    Write-Host "⚠️  Missing layouts: $($missingLayouts -join ', ')" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 4. Accessibility Check
Write-Host "4. Accessibility Best Practices" -ForegroundColor Yellow

$tsxFiles = Get-ChildItem -Path "src" -Recurse -Include "*.tsx" -Exclude "node_modules"
$missingAria = 0
$missingLang = 0

foreach ($file in $tsxFiles) {
    $content = Get-Content $file.FullName -Raw
    
    # Check for lang attribute in HTML
    if ($file.Name -eq "layout.tsx" -and $content -notmatch 'lang="ar"') {
        $missingLang++
    }
    
    # Check for aria-label on buttons without text
    if ($content -match '<button' -and $content -notmatch 'aria-label=') {
        $missingAria++
    }
}

if ($missingLang -eq 0) {
    Write-Host "✓ HTML lang attribute configured" -ForegroundColor Green
} else {
    Write-Host "⚠️  Missing lang attribute in some layouts" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 5. Icons Check
Write-Host "5. Icon Library" -ForegroundColor Yellow

if (Test-Path "node_modules/lucide-react") {
    Write-Host "✓ Lucide React installed" -ForegroundColor Green
} else {
    Write-Host "✗ Lucide React not found" -ForegroundColor Red
    $failures++
}

Write-Host ""

# 6. RTL Support Check
Write-Host "6. RTL Support" -ForegroundColor Yellow

$layoutContent = Get-Content "src/app/layout.tsx" -Raw
if ($layoutContent -match 'dir="rtl"' -or $layoutContent -match "dir:\s*['\"]rtl['\"]") {
    Write-Host "✓ RTL direction configured" -ForegroundColor Green
} else {
    Write-Host "⚠️  RTL direction not found in layout" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 7. Responsive Design Check
Write-Host "7. Responsive Design" -ForegroundColor Yellow

$tailwindConfig = Get-Content "tailwind.config.ts" -Raw
if ($tailwindConfig -match 'content:') {
    Write-Host "✓ Tailwind responsive classes available" -ForegroundColor Green
} else {
    Write-Host "⚠️  Check Tailwind content configuration" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""

# 8. Toast/Notification Components
Write-Host "8. Notification System" -ForegroundColor Yellow

$toastComponents = @(
    "src/hooks/use-toast.ts",
    "src/components/ui/toast.tsx",
    "src/components/ui/toaster.tsx"
)

$toastMissing = @()
foreach ($toast in $toastComponents) {
    if (-not (Test-Path $toast)) {
        $toastMissing += $toast
    }
}

if ($toastMissing.Count -eq 0) {
    Write-Host "✓ Toast notification system present" -ForegroundColor Green
} else {
    Write-Host "⚠️  Missing toast components: $($toastMissing -join ', ')" -ForegroundColor Yellow
    $warnings++
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "UI/UX Check Summary" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan

if ($failures -eq 0 -and $warnings -eq 0) {
    Write-Host "✓ All UI/UX checks passed!" -ForegroundColor Green
} elseif ($failures -eq 0) {
    Write-Host "⚠️  $warnings warning(s) - review for improvements" -ForegroundColor Yellow
} else {
    Write-Host "✗ $failures failure(s), $warnings warning(s)" -ForegroundColor Red
}

exit $failures