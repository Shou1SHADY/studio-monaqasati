# CONVENTIONS.md

## General Coding Standards
- **Language**: TypeScript with strict typing.
- **Framework**: Next.js App Router with React Server Components (RSC) where possible, and `'use client'` for interactive parts.
- **File Naming**: Kebab-case for files (`portal-layout.tsx`), except for React components which often follow kebab-case as well in this repo.

## UI & Styling
- **CSS Framework**: Tailwind CSS.
- **Variants**: `class-variance-authority` (CVA) for component variants.
- **Utility**: `cn()` utility for merging Tailwind classes (`tailwind-merge` + `clsx`).
- **Icons**: Lucide React icons.
- **Typography**: IBM Plex Sans Arabic (RTL layout).

## Data Fetching
- **Firebase SDK**: Direct client-side interaction using custom hooks.
- **Real-time**: Extensive use of `onSnapshot` (wrapped in hooks like `useDoc`, `useCollection`) to keep the UI in sync with Firestore.

## State Management
- **Local State**: `useState` and `useMemo`.
- **Global State**: Firebase Auth Context + custom providers.
- **AI State**: Managed via Genkit flows and client-side loading states.

## Error Handling
- **Toast Notifications**: `useToast()` from `src/hooks/use-toast.ts`.
- **Firebase Errors**: Centralized error emitter and listener (`src/firebase/error-emitter.ts`).
- **Form Validation**: Zod schemas used with React Hook Form.
