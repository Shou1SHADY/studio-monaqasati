# ARCHITECTURE.md

## Design Patterns
- **Role-Based Segmentation**: The application uses Next.js Route Groups (`(admin)`, `(contractor)`, `(supplier)`) to separate concerns and layouts for different user types.
- **Client-First Data Fetching**: Extensive use of Firebase client SDK with custom hooks (`useDoc`, `useCollection`) for real-time updates.
- **SaaS Portal Layout**: A unified `PortalLayout` component provides the sidebar, topbar, and navigation context for all authenticated roles.
- **AI Integration**: AI logic is encapsulated in Genkit "Flows" (`src/ai/flows`), which are called from the frontend.

## Data Flow
1. **Authentication**: Handled via `src/firebase/provider.tsx`, which exposes `useUser()` and `useAuth()`.
2. **Authorization**: `PortalLayout` checks `profile.role` and redirects users to their appropriate base path (`/admin`, `/contractor`, or `/supplier`).
3. **Firestore Interaction**: Components use `useFirestore()` and standard Firebase query functions to interact with collections.
4. **AI Logic**: Input from forms is passed to Genkit flows, which return structured data (e.g., recommended suppliers).

## Entry Points
- **Public**: `src/app/page.tsx` (Landing page), `/login`, `/register`.
- **Contractor**: `src/app/(contractor)/contractor/page.tsx` (Dashboard).
- **Supplier**: `src/app/(supplier)/supplier/page.tsx` (Dashboard).
- **Admin**: `src/app/(admin)/admin/page.tsx` (Dashboard).
