# REQUIREMENTS.md

## Functional Requirements

### FR-01: Organization Identity
- **REQ-01.1**: Every user must belong to an organization (even if it's a solo organization).
- **REQ-01.2**: A user can only belong to ONE organization at a time.
- **REQ-01.3**: An organization must be typed as either "Contractor" or "Supplier".

### FR-02: Team Management
- **REQ-02.1**: The account owner (CEO) can invite new members by email.
- **REQ-02.2**: The owner can remove members from the team.
- **REQ-02.3**: Members can view and accept/check offers related to their organization.

### FR-03: Data Access Control
- **REQ-03.1**: RFQs must be linked to an `organizationId`, not a `uid`.
- **REQ-03.2**: Offers must be linked to an `organizationId`.
- **REQ-03.3**: Notifications must be delivered to all relevant team members or the organization as a whole.

## Technical Requirements

### TR-01: Schema Updates
- **REQ-01.1**: Update `users` documents to include `organizationId` and `role` (owner/member).
- **REQ-01.2**: Update `rfqs`, `offers`, and `notifications` schemas to include `organizationId`.

### TR-02: Security Rules
- **REQ-02.1**: Update Firestore rules to allow read/write access based on `organizationId`.

### TR-03: UI Components
- **REQ-03.1**: Create a `TeamManagement` page for the Owner.
- **REQ-03.2**: Update `PortalLayout` to fetch data based on `organizationId`.
