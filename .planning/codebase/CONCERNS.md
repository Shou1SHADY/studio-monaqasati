# CONCERNS.md

## Technical Debt
- **Pagination Coverage**: The custom pagination hook (`use-collection-paginated.tsx`) is implemented but not yet used across all list pages (e.g., supplier RFQs, admin pages).
- **Manual Deployment Tasks**: Security rules and indexes are stored in the repo but require manual deployment via Firebase CLI.
- **Region Configuration**: Firestore initialization needs to be explicitly configured for the `me-west1` (Saudi Arabia) region to ensure PDPL compliance.

## Fragile Areas
- **Direct Firestore Access**: Most data access is done directly from the client. While security rules are defined, any logic errors in rules could lead to data exposure.
- **Role Redirection**: Authorization depends on a client-side redirect in `PortalLayout`. If the user has a slow connection, they might briefly see unauthorized content before the redirect kicks in.

## Future Scalability
- **Sub-user Management**: (Current Task) The system currently assumes 1 user = 1 account. Moving to a team/organization model will require significant changes to how data is queried (filtering by `organizationId` instead of `uid`).
- **AI Cost**: While caching is implemented, high volume of AI requests could still lead to significant costs if cache hit rates are low.

## Known Issues
- See `SYSTEM_DESIGN_FIXES.md` for a list of recent fixes and pending manual steps.
