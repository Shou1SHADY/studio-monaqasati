# مناقصتي Documentation Index

## Quick Links

| Document | Description |
|----------|-------------|
| [SETUP.md](SETUP.md) | Quick start guide |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Contribution guidelines |
| [docs/frontend/ARCHITECTURE.md](frontend/ARCHITECTURE.md) | Frontend architecture |
| [docs/backend/ARCHITECTURE.md](backend/ARCHITECTURE.md) | Backend architecture |
| [docs/api/API.md](api/API.md) | API reference |

## Project Overview

**مناقصتي** (Monaqasati) is a platform connecting contractors and suppliers for bidding on construction/material projects.

### Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Backend**: Firebase (Firestore, Auth, Functions)
- **AI**: Genkit with Gemini
- **Testing**: Jest + Playwright

### Core Features

1. **User Authentication** - Role-based access (Admin, Contractor, Supplier)
2. **Contractor Portal** - Create RFQs, manage offers
3. **Supplier Portal** - Browse RFQs, submit offers
4. **Admin Dashboard** - Manage users, view analytics
5. **AI Matching** - Smart RFQ-supplier recommendations
6. **Notifications** - Real-time in-app alerts

## Documentation Structure

```
docs/
├── SETUP.md                 # Quick start guide
├── CONTRIBUTING.md          # Contribution guide (root)
├── README.md                # This file
│
├── blueprint.md             # Original feature blueprint
├── backend.json             # Database schema (JSON)
│
├── frontend/
│   └── ARCHITECTURE.md      # Frontend architecture guide
│
├── backend/
│   └── ARCHITECTURE.md      # Backend architecture guide
│
└── api/
    └── API.md               # API reference documentation
```

## Key Resources

### Development
- [Getting Started](SETUP.md)
- [Available Scripts](../scripts/README.md)
- [Code Quality Checks](scripts/checks/code-quality.ps1)

### Architecture
- [Frontend Patterns](frontend/ARCHITECTURE.md)
- [Backend Data Model](backend/ARCHITECTURE.md)
- [API Endpoints](api/API.md)

### Design System
- [Color Palette](blueprint.md)
- [Typography](blueprint.md)
- [Components](src/components/ui/)

## Scripts Reference

```bash
# Quick validation
npm run check:quick

# Full check
npm run check:all

# CI pipeline
npm run ci
```

## External Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Firebase Documentation](https://firebase.google.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Genkit AI](https://firebase.google.com/docs/genkit)
- [Shadcn/ui](https://ui.shadcn.com/)

## Version Info

- Last Updated: 2026-05-04
- Next.js: 15.5.9
- Firebase: 11.9.1
- TypeScript: 5.x