# مدماك تيك (Monaqasati) - Project Setup Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Environment Setup](#environment-setup)
4. [Development](#development)
5. [Testing](#testing)
6. [Building](#building)
7. [Deployment](#deployment)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20.x LTS | Required |
| npm | 10.x | Comes with Node.js |
| Git | 2.x | Version control |
| Firebase CLI | 14.x | For Firebase deployment |
| Playwright | - | Installed via npm |

### Install Prerequisites

```bash
# Install Node.js from https://nodejs.org

# Install Firebase CLI globally
npm install -g firebase-tools

# Verify installations
node --version    # Should be 20.x
firebase --version # Should be 14.x
```

---

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd studio-mdmak-tech
npm install
```

### 2. Environment Setup

Copy the environment template:
```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your Firebase credentials:
```env
# Firebase Config
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# AI (Gemini)
NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_key

# Firebase Admin SDK (server-only — API routes)
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your_project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Transactional email (Resend) — supplier invitation emails
# 1. Create an account at https://resend.com
# 2. Add and verify a SUBDOMAIN as the sending domain (notifications.mdmaktech.sa)
#    via the DNS records Resend shows. Use a subdomain, not the root domain:
#    it isolates sending reputation from mdmaktech.sa and avoids touching the
#    root domain's existing mail (SPF/DKIM) records.
#    See https://resend.com/docs/knowledge-base/subdomain-vs-root-domain
# 3. Create an API key and set it here
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM="Mdmak Tech <noreply@notifications.mdmaktech.sa>"

# Public base URL used in emailed links (no trailing slash)
NEXT_PUBLIC_APP_URL=https://mdmaktech.sa
```

### 3. Run Development Server

```bash
npm run dev
```

Open http://localhost:9002 in your browser.

---

## Environment Setup

### Firebase Console Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. Enable Authentication (Email/Password)
4. Enable Firestore Database
5. Create web app and copy config

### Firestore Rules

Deploy security rules:
```bash
firebase deploy --only firestore
```

### Custom Claims (Production)

To set admin role, use Firebase Admin SDK:
```javascript
// Cloud Function
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.setAdminClaim = functions.https.onCall(async (data, context) => {
  if (context.auth.token.admin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Not an admin');
  }
  await admin.auth().setCustomUserClaims(data.uid, { admin: true });
  return { message: 'Admin claim set' };
});
```

---

## Development

### Available Scripts

```bash
# Development
npm run dev              # Start dev server on port 9002

# Code Quality
npm run lint             # Run ESLint
npm run typecheck        # Run TypeScript check

# Testing
npm run test             # Run Jest unit tests
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
npm run e2e              # Run Playwright E2E tests
npm run e2e:ui          # Playwright UI mode

# Build
npm run build           # Production build
npm run start           # Start production server

# AI / Genkit
npm run genkit:dev      # Start Genkit dev server
npm run genkit:watch    # Watch mode for AI flows
```

### Comprehensive Checks

```bash
# Quick check (TypeScript + ESLint)
npm run check:quick

# Full check (all tests + build)
npm run check:all

# Individual checks
npm run check:code       # Code quality
npm run check:tests      # Test suite
npm run check:security   # Security audit
npm run check:ui         # UI/UX check
npm run check:arch       # Architecture check
```

---

## Testing

### Unit Tests (Jest)

```bash
# Run all tests
npm run test

# Run in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

Tests are located in:
- `src/**/*.test.ts`
- `src/**/*.test.tsx`
- `src/**/*.spec.ts`
- `src/**/*.spec.tsx`

### E2E Tests (Playwright)

```bash
# Run all E2E tests
npm run e2e

# Run with UI
npm run e2e:ui

# Run specific test
npx playwright test e2e/auth.spec.ts
```

E2E tests are in the `e2e/` directory.

### Test Configuration

Jest config: `jest.config.ts`
Playwright config: `playwright.config.ts`

---

## Building

### Development Build

```bash
npm run build
```

### Production Build

The build creates optimized assets in `.next/`.

```bash
# Build and start production server
npm run build
npm run start
```

### Firebase Deployment

```bash
# Deploy to Firebase Hosting
firebase deploy --only hosting

# Deploy Firestore rules
firebase deploy --only firestore

# Deploy everything
firebase deploy
```

---

## Project Structure

```
studio-mdmak-tech/
├── src/
│   ├── app/                 # Next.js pages
│   │   ├── (admin)/        # Admin routes
│   │   ├── (contractor)/  # Contractor routes
│   │   ├── (supplier)/    # Supplier routes
│   │   ├── login/         # Public routes
│   │   └── register/
│   ├── components/
│   │   ├── ui/            # Shadcn/ui components
│   │   └── layout/       # Layout components
│   ├── firebase/          # Firebase config & hooks
│   │   └── firestore/    # Firestore hooks
│   ├── hooks/            # Custom React hooks
│   ├── lib/              # Utilities
│   └── ai/               # Genkit AI flows
├── docs/                  # Documentation
│   ├── backend/          # Backend docs
│   ├── frontend/         # Frontend docs
│   └── api/              # API docs
├── scripts/              # Automation scripts
├── e2e/                  # Playwright tests
├── firestore.rules       # Firestore security
├── firebase.json         # Firebase config
├── tailwind.config.ts    # Tailwind config
├── jest.config.ts        # Jest config
└── playwright.config.ts  # Playwright config
```

---

## Troubleshooting

### Common Issues

#### Port Already in Use
```bash
# Find and kill process on port 9002
lsof -i :9002  # Mac/Linux
netstat -ano | findstr :9002  # Windows
```

#### Node Modules Issues
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

#### Firebase Emulator
```bash
# Start Firebase emulators
firebase emulators:start
```

#### Build Errors
```bash
# Clear .next cache
rm -rf .next
npm run build
```

### Getting Help

1. Check [docs/](docs/) for detailed documentation
2. Run `npm run check:quick` for quick validation
3. Check Firebase Console for auth/db issues

---

## Next Steps

- Read [Frontend Architecture](docs/frontend/ARCHITECTURE.md)
- Read [Backend Architecture](docs/backend/ARCHITECTURE.md)
- Read [API Reference](docs/api/API.md)
- Review [Blueprints](docs/blueprint.md)