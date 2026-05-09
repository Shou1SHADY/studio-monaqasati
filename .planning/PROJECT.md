# PROJECT.md

## Vision
Implement "Organization & Team Management" functionality to allow primary users (CEOs/Owners) to manage their teams. This enables collaborative procurement workflows while maintaining strict segregation between Contractor and Supplier organizations.

## Core Objectives
- **Multi-user Accounts**: Allow multiple users to share a single organization's data (RFQs, Offers, Profile).
- **Role-Based Access Control (RBAC)**: Differentiate between "Owner" (full control) and "Team Member" (operational access).
- **Strict Segregation**: Ensure teams are either exclusively "Contractor" or "Supplier".
- **Unified Organization Profile**: Share company details, certificates, and scores across the entire team.

## Scope (v1)
- **Organization Identity**: Introduce `organizationId` and `organizationRole` fields to users.
- **Team Management UI**: A dashboard for Owners to invite and manage team members.
- **Invitation Flow**: Email-based invitation system.
- **Data Filtering**: Update all Firestore queries to filter by `organizationId`.

## Out of Scope
- Granular permission matrices (beyond Owner/Member).
- Cross-organization collaboration.
- Enterprise SSO integration.
