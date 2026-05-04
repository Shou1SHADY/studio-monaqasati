# =============================================================================
# GSD Skills Integration - Quick Reference
# =============================================================================
# This file documents how to use GSD skills with مناقصتي
# =============================================================================

# ============================================================================
# Available Skills
# ============================================================================

## Code Review & Quality
```
/gsd-code-review              # Review code for bugs, security, quality
/gsd-code-review --fix       # Auto-fix issues found
/gsd-code-review --depth=deep # Comprehensive review
```

## Audit & Fix
```
/gsd-audit-fix               # Auto-audit and fix medium+ issues
/gsd-audit-fix --dry-run    # Show what would be fixed
/gsd-audit-fix --max 10     # Fix up to 10 issues
/gsd-audit-fix --severity high # Only fix high severity
```

## Health & Validation
```
/gsd-health                  # Check project health
/gsd-health --repair        # Auto-repair issues
/gsd-health --context       # Check context utilization
```

## Phase Validation
```
/gsd-validate-phase         # Validate current phase
/gsd-validate-phase 2      # Validate specific phase
```

## UI/UX
```
/ui-ux-pro-max              # Get UI/UX design guidance
# Usage: python3 .opencode/skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system
```

## Architecture
```
/principal-architecture-review # Get principal-level architecture review
```

## Workflow
```
/gsd-ns-review              # Quality gates review
/gsd-stats                  # Project statistics
/gsd-help                   # Show all GSD commands
```

# ============================================================================
# Recommended Workflows
# ============================================================================

## Before Starting Work
```
/gsd-health --context       # Check if fresh context needed
```

## After Making Changes
```
/gsd-code-review            # Review what changed
```

## Before Committing
```
/gsd-audit-fix --dry-run    # See what issues exist
npm run validate            # Full validation
```

## For New Features
```
# 1. Plan with GSD
/gsd-plan-phase            # Plan new phase

# 2. Execute
/gsd-execute-phase         # Run phase plans

# 3. Review
/gsd-code-review           # Review changes
/gsd-validate-phase       # Validate phase
```

# ============================================================================
# Quick Commands (via npm run)
# ============================================================================

# Quick validation (30 sec)
npm run check:quick

# Full validation (5-10 min)
npm run validate

# Comprehensive (all tests)
npm run validate:full

# Individual checks
npm run check:code        # TypeScript + ESLint + Build
npm run check:tests      # Unit + E2E tests
npm run check:security   # Security audit
npm run check:ui         # UI/UX check
npm run check:arch       # Architecture check

# Node runner
node scripts/runner.js help
node scripts/runner.js list
node scripts/runner.js validate
node scripts/runner.js dev

# ============================================================================
# PowerShell Scripts
# ============================================================================

# Main validation
.\scripts\validate-app.ps1

# Options
.\scripts\validate-app.ps1 -Quick        # Fast check
.\scripts\validate-app.ps1 -Full        # Full with E2E
.\scripts\validate-app.ps1 -Verbose     # Detailed output
.\scripts\validate-app.ps1 -SkipE2E     # Skip E2E tests
.\scripts\validate-app.ps1 -SkipBuild  # Skip build

# Individual checks
.\scripts\check-all.ps1                  # Full check
.\scripts\quick-check.ps1                # Quick check

.\scripts\checks\code-quality.ps1       # Code quality
.\scripts\checks\tests.ps1              # Tests
.\scripts\checks\security.ps1           # Security
.\scripts\checks\ui-ux.ps1              # UI/UX
.\scripts\checks\architecture.ps1       # Architecture

# ============================================================================
# Documentation
# ============================================================================

# Setup Guide
docs/SETUP.md

# Complete Guide
docs/COMPLETE-GUIDE.md

# Architecture
docs/frontend/ARCHITECTURE.md
docs/backend/ARCHITECTURE.md

# API
docs/api/API.md

# Scripts
scripts/README.md
scripts/checks/

# ============================================================================
# First Time Setup
# ============================================================================

# Enable PowerShell scripts (run as Administrator)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Install dependencies
npm install

# Create .env.local from template
Copy-Item .env.local.example .env.local

# Verify environment
npm run check:quick

# Run full validation
npm run validate

# Start development
npm run dev