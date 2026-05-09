# ROADMAP.md

## Milestone 1: User Management & Team Collaboration

### Phase 1: Database & Core Logic Foundation
- Update user schema to include `organizationId` and `role`.
- Implement migration script to set `organizationId` for existing users (using their `uid`).
- Update Firestore rules to support organization-based access.

### Phase 2: Application-Wide Data Mapping
- Refactor all RFQ and Offer queries to use `organizationId` instead of `uid`.
- Ensure notifications are correctly associated with organizations.
- Update profile pages to reflect organization-level data.

### Phase 3: Team Management UI
- Build the "Team" settings page for Contractors.
- Build the "Team" settings page for Suppliers.
- Implement "Invite Member" functionality.

### Phase 4: Invitation & Onboarding Flow
- Create the invitation acceptance page/flow.
- Handle registration of invited members and linking them to the organization.
- Test cross-user collaboration (e.g., Member A creates RFQ, Member B checks offers).
