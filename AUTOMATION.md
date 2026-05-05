# =============================================================================
# Complete Automation Index - مدماك تيك
# =============================================================================
# 
# This file documents all automation created for the project
# Use this as a reference for running checks and setting up CI/CD
# =============================================================================

## QUICK START

```powershell
# 1. Enable PowerShell execution (run as Admin)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 2. Install dependencies
npm install

# 3. Run quick check
npm run check:quick
```

---

## MANUAL CHECKS

### NPM Scripts (run via `npm run ...`)

| Command | Description | Duration |
|---------|-------------|----------|
| `check:quick` | Fast validation (TypeScript + ESLint) | 30 sec |
| `validate` | Professional validation suite | 5-10 min |
| `validate:full` | Full with E2E tests | 10-15 min |
| `check:all` | All checks combined | 5-10 min |
| `check:code` | TypeScript + ESLint + Build | 2-3 min |
| `check:tests` | Unit + E2E tests | 5-10 min |
| `check:security` | Security audit | 30 sec |
| `check:ui` | UI/UX validation | 30 sec |
| `check:arch` | Architecture check | 20 sec |
| `ci` | Full CI pipeline | 10-15 min |

### Direct PowerShell Scripts

```powershell
# Main validation
.\scripts\validate-app.ps1
.\scripts\validate-app.ps1 -Quick        # Fast mode
.\scripts\validate-app.ps1 -Full          # Include E2E
.\scripts\validate-app.ps1 -Verbose      # Detailed output
.\scripts\validate-app.ps1 -SkipE2E      # Skip E2E
.\scripts\validate-app.ps1 -SkipBuild    # Skip build

# Quick check
.\scripts\quick-check.ps1

# Full check
.\scripts\check-all.ps1

# Individual checks
.\scripts\checks\code-quality.ps1
.\scripts\checks\tests.ps1
.\scripts\checks\security.ps1
.\scripts\checks\ui-ux.ps1
.\scripts\checks\architecture.ps1
```

---

## AUTOMATIC CHECKS (GIT HOOKS)

### Pre-Commit Hook
Automatically runs before each commit:
- TypeScript type check
- ESLint validation
- Unit tests
- Security audit

**Location:** `.git/hooks/pre-commit`

**To install:** Run `.\scripts\setup-hooks.ps1`

**To bypass (not recommended):**
```bash
git commit --no-verify
```

### Post-Commit Hook
Shows status after each commit:
- Last commit info
- Working tree status
- Next steps suggestions

**Location:** `.git/hooks/post-commit`

---

## CI/CD AUTOMATION

### GitHub Actions Workflow
**Location:** `.github/workflows/ci.yml`

Runs on:
- Every push to main, develop, feature/*
- Every pull request to main, develop

**Jobs:**
1. Code Quality (TypeScript, ESLint, Build)
2. Unit Tests (Jest + Coverage)
3. E2E Tests (Playwright)
4. Security Audit (NPM audit + secrets)
5. UI/UX Validation
6. Firebase Rules Validation
7. Bundle Analysis
8. Summary Report

**Manual Trigger:**
```bash
git push origin main
```

---

## GSD SKILLS INTEGRATION

Use these for advanced automation:

```bash
# Code review
/gsd-code-review
/gsd-code-review --fix
/gsd-code-review --depth=deep

# Audit and fix
/gsd-audit-fix
/gsd-audit-fix --dry-run
/gsd-audit-fix --severity high

# Health check
/gsd-health
/gsd-health --context

# Phase validation
/gsd-validate-phase

# UI/UX guidance
/ui-ux-pro-max
```

---

## WHAT GETS CHECKED

### Code Quality
- [x] TypeScript compilation
- [x] ESLint rules
- [x] Build success
- [x] Import correctness

### Testing
- [x] Unit tests (Jest)
- [x] Test coverage report
- [x] E2E tests (Playwright)

### Security
- [x] NPM vulnerabilities
- [x] Secret exposure
- [x] Firebase rules patterns

### UI/UX
- [x] Tailwind config
- [x] Design system components
- [x] RTL support
- [x] Accessibility (ARIA, lang)

### Architecture
- [x] Project structure
- [x] Required directories
- [x] Config files
- [x] Firebase setup

---

## DEVELOPMENT WORKFLOW

### Recommended Flow

1. **Before starting work:**
   ```bash
   /gsd-health --context
   ```

2. **During development:**
   ```bash
   npm run check:quick  # Run frequently
   ```

3. **Before committing:**
   ```bash
   npm run validate     # Full validation
   git commit -m "..."  # Hooks run automatically
   ```

4. **After commit:**
   ```bash
   git push             # Triggers CI
   /gsd-code-review     # Optional review
   ```

---

## FILE STRUCTURE

```
studio-mdmak-tech/
├── .git/hooks/              # Git hooks
│   ├── pre-commit          # Pre-commit validation
│   ├── pre-commit.ps1      # PowerShell version
│   └── post-commit         # Post-commit status
├── .github/workflows/      # CI/CD
│   └── ci.yml              # GitHub Actions
├── scripts/                # Automation scripts
│   ├── validate-app.ps1    # Main validation
│   ├── check-all.ps1       # Full check
│   ├── quick-check.ps1     # Quick check
│   ├── setup-hooks.ps1     # Hook installer
│   ├── runner.js           # Command runner
│   ├── check-all.js        # Node version
│   └── checks/             # Individual checks
│       ├── code-quality.ps1
│       ├── tests.ps1
│       ├── security.ps1
│       ├── ui-ux.ps1
│       └── architecture.ps1
├── docs/                   # Documentation
│   ├── COMPLETE-GUIDE.md   # Full guide
│   ├── SETUP.md           # Setup guide
│   ├── GSD-INTEGRATION.md  # GSD skills
│   ├── frontend/           # Frontend docs
│   ├── backend/            # Backend docs
│   └── api/                # API docs
└── package.json            # NPM scripts
```

---

## TROUBLESHOOTING

### PowerShell execution disabled
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### NPM not working
```powershell
# Clear cache
npm cache clean --force

# Reinstall
Remove-Item node_modules, package-lock.json -Recurse
npm install
```

### Hooks not running
```powershell
# Reinstall hooks
.\scripts\setup-hooks.ps1
```

### Tests failing
```bash
# Check specific
npm run test -- --verbose

# Update snapshots
npm run test -- --updateSnapshot
```

---

## ADDING NEW CHECKS

To add a new check:

1. Create script in `scripts/checks/`
2. Follow naming pattern: `check-name.ps1`
3. Add to package.json scripts
4. Add to CI workflow if needed

Example:
```powershell
# scripts/checks/my-check.ps1
Write-Host "Running my check..." -ForegroundColor Yellow
# ... do checks ...
Write-Host "✓ My check passed" -ForegroundColor Green
```

---

## VERSION INFO

- Created: 2026-05-04
- Version: 1.0.0
- Node.js: 20.x
- Next.js: 15.5.9
- TypeScript: 5.x