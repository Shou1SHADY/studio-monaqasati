# مناقصتي - Complete Development Guide

## Table of Contents
1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Development Workflow](#development-workflow)
6. [Automation Scripts](#automation-scripts)
7. [Quality Gates](#quality-gates)
8. [GSD Skills Integration](#gsd-skills-integration)
9. [UI/UX Guidelines](#uiux-guidelines)
10. [API Reference](#api-reference)
11. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Prerequisites
- Node.js 20.x LTS
- npm 10.x
- Git
- PowerShell 5.1+ (Windows)

### Setup
```powershell
# Clone and install
git clone <repo-url>
cd studio-monaqasati
npm install

# Copy environment template
Copy-Item .env.local.example .env.local

# Start development
npm run dev
```

### Quick Validation
```powershell
# Fast check (30 seconds)
npm run check:quick

# Full validation (5-10 minutes)
npm run check:all

# Professional validation (recommended)
.\scripts\validate-app.ps1 -Full
```

---

## Architecture Overview

### Frontend Architecture
```
src/
├── app/                    # Next.js App Router
│   ├── (admin)/           # Admin route group
│   ├── (contractor)/      # Contractor route group
│   ├── (supplier)/        # Supplier route group
│   ├── login/             # Public auth routes
│   └── page.tsx           # Landing page
├── components/
│   ├── ui/                # Shadcn/ui base components
│   ├── layout/            # Layout components
│   └── *.tsx              # Feature components
├── firebase/              # Firebase integration
│   ├── config.ts          # Firebase config
│   ├── provider.tsx       # React context
│   └── firestore/         # Firestore hooks
├── hooks/                 # Custom React hooks
├── lib/                   # Utilities
└── ai/                    # Genkit AI flows
```

### Backend Architecture
- **Firestore**: NoSQL database with role-based collections
- **Auth**: Firebase Authentication with custom claims
- **Functions**: Cloud Functions for server-side logic
- **AI**: Genkit with Gemini for smart matching

### Data Model
- **Users**: Contractors, Suppliers, Admins with role-based profiles
- **RFQs**: Request for Quotations with category, location, deadline
- **Offers**: Supplier bids with pricing and delivery
- **Notifications**: In-app alerts for real-time updates

---

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Framework | Next.js | 15.5.9 |
| Language | TypeScript | 5.x |
| UI | React | 19.2.1 |
| Styling | Tailwind CSS | 3.4.1 |
| Components | Shadcn/ui | Latest |
| Auth | Firebase Auth | 11.9.1 |
| Database | Firestore | 11.9.1 |
| AI | Genkit + Gemini | 1.28.0 |
| Testing | Jest + Playwright | 30.3 + 1.59 |
| Charts | Recharts | 2.15.1 |
| Maps | React Leaflet | 5.0.0 |

---

## Project Structure

```
studio-monaqasati/
├── src/                    # Source code
│   ├── app/               # Pages
│   ├── components/       # UI components
│   ├── firebase/         # Firebase
│   ├── hooks/            # Custom hooks
│   ├── lib/              # Utilities
│   └── ai/               # AI flows
├── docs/                  # Documentation
│   ├── frontend/         # Frontend docs
│   ├── backend/          # Backend docs
│   ├── api/              # API docs
│   ├── SETUP.md          # Setup guide
│   └── ARCHITECTURE.md  # Architecture
├── scripts/              # Automation
│   ├── validate-app.ps1  # Main validation
│   ├── check-all.ps1    # Full check
│   └── checks/          # Individual checks
├── e2e/                  # E2E tests
├── firestore.rules       # DB rules
├── tailwind.config.ts   # Tailwind config
└── package.json         # Dependencies
```

---

## Development Workflow

### 1. Before Starting
```powershell
# Enable PowerShell scripts
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Verify environment
.\scripts\validate-app.ps1 -Quick
```

### 2. During Development
```powershell
# Quick validation (recommended)
npm run check:quick

# Or run specific checks
npm run check:code      # TypeScript + ESLint
npm run check:security  # Security audit
npm run check:ui        # UI/UX check
```

### 3. Before Committing
```powershell
# Full validation
npm run check:all

# Or professional validation
.\scripts\validate-app.ps1 -Full
```

### 4. After Code Changes
```powershell
# Code review using GSD
/gsd-code-review

# Or auto-audit and fix
/gsd-audit-fix --severity medium
```

---

## Automation Scripts

### Main Scripts

| Script | Purpose | Duration |
|--------|---------|----------|
| `validate-app.ps1` | Comprehensive validation | 5-10 min |
| `check-all.ps1` | Full check all aspects | 5-10 min |
| `quick-check.ps1` | Fast TypeScript + ESLint | 30 sec |

### Individual Checks

| Command | Checks |
|---------|--------|
| `scripts/checks/code-quality.ps1` | TypeScript, ESLint, Build |
| `scripts/checks/tests.ps1` | Unit + E2E tests |
| `scripts/checks/security.ps1` | NPM audit, secrets |
| `scripts/checks/ui-ux.ps1` | Design system, RTL |
| `scripts/checks/architecture.ps1` | Structure, config |

### NPM Scripts

```powershell
npm run check:quick    # Fast validation
npm run check:all     # Full check
npm run check:code    # Code quality
npm run check:tests   # Testing
npm run check:security # Security
npm run check:ui      # UI/UX
npm run check:arch    # Architecture
npm run ci           # CI pipeline
```

---

## Quality Gates

### Gate 1: Code Quality
- ✓ TypeScript compiles without errors
- ✓ ESLint passes with no critical issues
- ✓ Build succeeds

### Gate 2: Testing
- ✓ All unit tests pass
- ✓ E2E tests pass (when run)
- ✓ Coverage > 70%

### Gate 3: Security
- ✓ No high-severity vulnerabilities
- ✓ No secrets in code
- ✓ Firebase rules valid

### Gate 4: Architecture
- ✓ Project structure follows conventions
- ✓ All required files present
- ✓ Configuration valid

### Gate 5: UI/UX
- ✓ Design tokens defined
- ✓ Components present
- ✓ RTL support configured

---

## GSD Skills Integration

### Recommended Workflow

```powershell
# 1. Before starting new feature
/gsd-health --context

# 2. After making changes
/gsd-code-review --depth=standard

# 3. If issues found
/gsd-audit-fix --severity medium

# 4. For validation
/gsd-validate-phase

# 5. For architecture review
/principal-architecture-review
```

### Skill Summary

| Skill | Purpose |
|-------|---------|
| `/gsd-code-review` | Bug, security, quality review |
| `/gsd-audit-fix` | Auto-fix issues |
| `/gsd-health` | Project health check |
| `/gsd-validate-phase` | Phase validation |
| `/gsd-ns-review` | Quality gates |
| `/gsd-stats` | Project statistics |
| `/principal-architecture-review` | Architecture review |
| `/ui-ux-pro-max` | UI/UX guidance |

---

## UI/UX Guidelines

### Design System

**Colors:**
- Primary: `#2874D4` (Trust blue)
- Background: `#ECF2F9` (Soft blue-grey)
- Accent: `#20CBD5` (Cyan)
- Sidebar: `#0B1F3A` (Navy)
- Success: `#12A063` (Green)
- Error: `#DC2626` (Red)

**Typography:**
- Font: IBM Plex Sans Arabic
- Direction: RTL
- Scale: 4px grid

**Components:**
- Cards: White, 12px radius, 1px border
- Buttons: Primary, hover states
- Forms: Labeled, validated
- Tables: Sortable, paginated

### Best Practices

1. **No emojis as icons** - Use Lucide React
2. **Consistent spacing** - 4px grid
3. **Hover states** - Visual feedback
4. **Loading states** - Skeleton screens
5. **Error handling** - User-friendly messages
6. **Accessibility** - ARIA, focus states
7. **Mobile-first** - Responsive design

---

## API Reference

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Current user

### RFQs
- `GET /api/rfqs` - List RFQs
- `POST /api/rfqs` - Create RFQ
- `GET /api/rfqs/{id}` - Get RFQ
- `PUT /api/rfqs/{id}` - Update RFQ

### Offers
- `GET /api/rfqs/{id}/offers` - List offers
- `POST /api/rfqs/{id}/offers` - Submit offer
- `POST /api/offers/{id}/accept` - Accept
- `POST /api/offers/{id}/reject` - Reject

### Notifications
- `GET /api/notifications` - List
- `POST /api/notifications/{id}/read` - Mark read

See `docs/api/API.md` for full reference.

---

## Troubleshooting

### Common Issues

**Port in use:**
```powershell
Get-NetTCPConnection -LocalPort 9002 | Stop-Process
```

**Node modules issues:**
```powershell
Remove-Item node_modules, package-lock.json -Recurse
npm install
```

**Build errors:**
```powershell
Remove-Item .next -Recurse
npm run build
```

**TypeScript errors:**
```powershell
npm run typecheck
```

### Getting Help

1. Run validation: `.\scripts\validate-app.ps1 -Verbose`
2. Check docs: `docs/SETUP.md`
3. Use GSD: `/gsd-health`
4. Review architecture: `docs/frontend/ARCHITECTURE.md`

---

## Resources

- [Next.js Docs](https://nextjs.org/docs)
- [Firebase Docs](https://firebase.google.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Genkit AI](https://firebase.google.com/docs/genkit)
- [Shadcn/ui](https://ui.shadcn.com)

---

## Version Info

- Last Updated: 2026-05-04
- Next.js: 15.5.9
- Firebase: 11.9.1
- TypeScript: 5.x
- Validation: Professional Suite v1.0