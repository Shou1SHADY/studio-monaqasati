---
description: Firebase and API route conventions
globs:
  - "src/app/api/**"
  - "src/firebase/**"
  - "firestore.rules"
---

# Firebase & API Rules — Studio Monaqasati

## Firebase Client

- Client SDK is initialized in `src/firebase/` — use `FirebaseClientProvider` context
- NEVER use Firebase Admin SDK in client components
- Import Firestore helpers from `@/firebase/` wrappers, not directly from `firebase/firestore`
- All Firebase operations should be inside try/catch with user-friendly error messages

## Firestore Conventions

- Collection naming: `camelCase` (e.g., `rfqRequests`, `supplierProfiles`)
- Document IDs: use Firebase auto-ID (`addDoc`) unless you have a meaningful natural key
- Always update `firestore.rules` when adding/modifying collection access
- Use subcollections for 1:many relationships (e.g., `rfqRequests/{id}/offers`)
- Timestamps: use `serverTimestamp()` for `createdAt`/`updatedAt` fields

## API Routes (src/app/api/)

- Validate ALL inputs — use `zod` schemas at the top of each route
- Return consistent error shape:
  ```json
  { "error": true, "message": "Human-readable message", "code": "ERROR_CODE" }
  ```
- Return consistent success shape:
  ```json
  { "success": true, "data": {...} }
  ```
- Always check authentication before accessing protected resources
- Never expose Firebase Admin credentials or stack traces to the client
- Use `NextResponse.json()` with explicit status codes

## Genkit AI (src/ai/)

- AI flows live in `src/ai/` — import via `@/ai/`
- Dev server: `npm run genkit:dev`
- Always handle AI errors gracefully — show fallback UI, not raw errors
- Rate limit AI calls — don't call on every keystroke

## Security Rules

- Firestore rules file: `firestore.rules` — test changes with Firebase emulator
- Storage rules file: `storage.rules`
- Never store sensitive data (passwords, keys) in Firestore documents
