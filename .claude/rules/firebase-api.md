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

- Collection naming: `camelCase` (e.g., `crmContacts`, `accessRequests`)
- Document IDs: use Firebase auto-ID (`addDoc`) unless you have a meaningful natural key
  (e.g., `crmOrgProfile/{organizationId}`, `invitations/{email}`)
- Always update `firestore.rules` when adding/modifying collection access
- Use subcollections for 1:many under a clear parent (`projects/{id}/boqItems`,
  `warehouses/{id}/inventoryItems`); use org-scoped TOP-LEVEL collections when the
  page needs one org-wide query (that's why `crmOpportunities`/`crmQuotations` moved
  out of `crmContacts` subcollections)
- Timestamps: use `serverTimestamp()` for `createdAt`/`updatedAt` fields
- Cross-user notifications: write to `users/{targetUid}/notifications` (any signed-in
  user may create; only the target reads them)
- Append-only ledgers (`wasteRecords`, `transfers`): corrections are reversal entries,
  never edits — rules block client update/delete
- Permission-gated writes mirror `src/lib/permissions.ts` in rules helpers
  (`hasOrgPermission`, `hasProjectPermission`, `hasRfqPermission`) — keep both sides
  in sync when adding a permission (e.g., `crm.close`)

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
- **Deploying rules:** `firebase deploy` does NOT work in this environment — use the
  `firebaserules.googleapis.com` REST API (see "Deploying firestore.rules" in
  CLAUDE.md). ALWAYS `git fetch` and diff `firestore.rules` against `origin/main`
  before deploying: a stale local copy overwrites other sessions' live rules
- Rules gotcha: reading `.data` off a missing doc, or a missing field, is an
  evaluation ERROR (denies the write outright) — guard with `exists()` and
  `.get('field', default)` so refusals stay clean
- A member's `organizationId` IS the org owner's uid — owner-side rules check
  `resource.data.organizationId == request.auth.uid`
