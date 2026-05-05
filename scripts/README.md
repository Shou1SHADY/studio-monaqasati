# Scripts Documentation - مدماك تيك

## Overview

This directory contains automation scripts for checking and maintaining the application quality.

## Available Scripts

### Quick Check
```powershell
# Fast check - TypeScript + ESLint only
npm run check:quick
# or
powershell -ExecutionPolicy Bypass -File scripts/quick-check.ps1
```

### Full Check
```powershell
# All checks - TypeScript, ESLint, Build, Tests, E2E, Security
npm run check:all
# or
powershell -ExecutionPolicy Bypass -File scripts/check-all.ps1
```

### Individual Checks

| Command | Description |
|---------|-------------|
| `npm run check:code` | TypeScript + ESLint + Build |
| `npm run check:tests` | Unit tests + E2E tests |
| `npm run check:security` | NPM audit + secrets check |
| `npm run check:ui` | UI/UX best practices |
| `npm run check:arch` | Architecture patterns |

## Script Files

### Main Scripts
- `check-all.ps1` - Full comprehensive check (PowerShell)
- `check-all.js` - Full comprehensive check (Node.js)
- `quick-check.ps1` - Quick validation

### Check Scripts
- `checks/code-quality.ps1` - TypeScript, ESLint, Build
- `checks/tests.ps1` - Unit and E2E tests
- `checks/security.ps1` - Security audit
- `checks/ui-ux.ps1` - UI/UX validation
- `checks/architecture.ps1` - Architecture patterns

## Usage Examples

### CI/CD Pipeline
```bash
# Quick check during development
npm run check:quick

# Full validation before commit
npm run check:all

# Pre-commit hook
npm run ci
```

### Manual Checks
```powershell
# Run specific check
.\scripts\check-all.ps1

# Skip E2E tests (faster)
.\scripts\check-all.ps1 -SkipE2E

# Skip build (if already built)
.\scripts\check-all.ps1 -SkipBuild

# Quick mode
.\scripts\check-all.ps1 -Quick
```

### Individual Checks
```powershell
# Code quality
.\scripts\checks\code-quality.ps1

# Test suite
.\scripts\checks\tests.ps1 -UnitOnly

# Security
.\scripts\checks\security.ps1

# UI/UX
.\scripts\checks\ui-ux.ps1

# Architecture
.\scripts\checks\architecture.ps1
```

## What Each Check Validates

### Code Quality
- TypeScript compilation
- ESLint rules
- Build success

### Tests
- Jest unit tests with coverage
- Playwright E2E tests

### Security
- NPM vulnerabilities
- Secret exposure
- Firebase rules validation

### UI/UX
- Tailwind configuration
- Design system components
- Accessibility (ARIA, lang)
- RTL support
- Responsive design
- Toast/notification system

### Architecture
- Project structure
- Firebase setup
- Firestore hooks
- Route groups
- Error handling
- AI/Genkit setup
- Documentation

## Exit Codes

- `0` - All checks passed
- `1` - One or more checks failed

## Notes

- E2E tests require dev server to be running
- Some checks may require internet access (NPM audit)
- Scripts are optimized for Windows (PowerShell)
- For Linux/Mac, use the bash scripts (`.sh`)