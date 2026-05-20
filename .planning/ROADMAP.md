# ROADMAP.md

## Milestone 1: User Management & Team Collaboration

### Phase 1: Database & Core Logic Foundation [x]
- [x] Update user schema to include `organizationId` and `role`.
- [x] Implement migration script to set `organizationId` for existing users (using their `uid`).
- [x] Update Firestore rules to support organization-based access.

### Phase 2: Application-Wide Data Mapping [x]
- [x] Refactor all RFQ and Offer queries to use `organizationId` instead of `uid`.
- [x] Ensure notifications are correctly associated with organizations.
- [x] Update profile pages to reflect organization-level data.

### Phase 3: Team Management UI [x]
- [x] Build the "Team" settings page for Contractors.
- [x] Build the "Team" settings page for Suppliers.
- [x] Implement "Invite Member" functionality.

### Phase 4: Invitation & Onboarding Flow [x]
- [x] Create the invitation acceptance page/flow.
- [x] Handle registration of invited members and linking them to the organization.
- [x] Test cross-user collaboration (e.g., Member A creates RFQ, Member B checks offers).

### Phase 5: Google Authentication & Security Advanced [x]
- [x] Integrate Google Sign-In and Sign-Up.
- [x] Add standard email verification gate.
- [x] Build opt-in 2-step verification (MFA) via SMS OTP.
- [x] Create Profile security settings controls.
