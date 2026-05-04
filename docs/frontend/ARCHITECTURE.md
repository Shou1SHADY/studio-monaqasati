# Frontend Architecture - مناقصتي

## Overview

The frontend is built with **Next.js 15** (App Router), **React 19**, **TypeScript**, and **Tailwind CSS**. It uses a component-based architecture with the Shadcn/ui design system.

## Tech Stack

| Category | Technology | Version |
|----------|------------|---------|
| Framework | Next.js | 15.5.9 |
| UI Library | React | 19.2.1 |
| Styling | Tailwind CSS | 3.4.1 |
| Components | Shadcn/ui | Latest |
| State | React Hook Form + Zod | 7.54.2 / 3.24.2 |
| Charts | Recharts | 2.15.1 |
| Maps | React Leaflet | 5.0.0 |
| Icons | Lucide React | 0.475.0 |
| Auth | Firebase Auth | 11.9.1 |
| Database | Firebase Firestore | 11.9.1 |
| Testing | Jest + Playwright | 30.3.0 / 1.59.1 |
| AI | Genkit | 1.28.0 |

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (admin)/           # Admin route group
│   │   └── admin/        # Admin dashboard & pages
│   ├── (contractor)/     # Contractor route group
│   │   └── contractor/   # Contractor portal
│   ├── (supplier)/        # Supplier route group
│   │   └── supplier/     # Supplier portal
│   ├── login/            # Login page
│   ├── register/         # Registration page
│   ├── chat/             # Chat functionality
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Landing page
├── components/
│   ├── ui/               # Shadcn/ui components
│   ├── layout/           # Layout components (sidebar, portal-layout)
│   └── *.tsx             # Feature components
├── firebase/             # Firebase client
│   ├── config.ts         # Firebase configuration
│   ├── provider.tsx      # React context provider
│   ├── client-provider.tsx
│   ├── firestore/        # Firestore hooks
│   │   ├── use-collection.tsx
│   │   ├── use-doc.tsx
│   │   └── use-collection-paginated.tsx
│   ├── errors.ts         # Error handling
│   └── index.ts          # Firebase exports
├── hooks/                # Custom React hooks
│   ├── use-toast.ts      # Toast notifications
│   └── use-mobile.tsx   # Mobile detection
├── lib/                  # Utility functions
│   ├── utils.ts         # cn() helper
│   ├── constants.ts     # App constants
│   └── placeholder-images.ts
└── ai/                   # Genkit AI flows
    ├── flows/           # AI flow implementations
    ├── genkit.ts        # Genkit config
    └── dev.ts           # Dev server
```

## Route Structure

### Public Routes
- `/` - Landing page
- `/login` - Login page
- `/register` - Registration page

### Role-Based Routes (Protected)
- `/admin/*` - Admin dashboard (requires admin role)
- `/contractor/*` - Contractor portal (requires contractor role)
- `/supplier/*` - Supplier portal (requires supplier role)

### Shared Routes
- `/chat/[chatId]` - Chat functionality (all roles)

## UI/UX Guidelines

### Design Tokens

```css
:root {
  /* Primary Colors */
  --primary: #2874D4;        /* Trust & professionalism */
  --primary-hover: #1E5BA8;
  --background: #ECF2F9;     /* Soft blue-grey */
  --accent: #20CBD5;         /* Vivid cyan */
  
  /* Sidebar */
  --sidebar: #0B1F3A;        /* Dark navy */
  
  /* Cards */
  --card: #FFFFFF;
  --card-border: #E2E8F0;
  --card-radius: 12px;
  
  /* Semantic */
  --success: #12A063;
  --error: #DC2626;
  --warning: #F59E0B;
  
  /* Typography */
  --font-family: 'IBM Plex Sans Arabic', sans-serif;
}
```

### Layout Principles

1. **RTL-First**: All content flows right-to-left
2. **Sidebar Navigation**: Persistent dark navy sidebar on the right
3. **Card-Based Content**: Clean white cards with subtle borders
4. **Responsive**: Mobile-first with breakpoints at 640px, 768px, 1024px, 1280px

### Component Guidelines

- Use Shadcn/ui components as base
- Follow consistent spacing (4px grid: 4, 8, 12, 16, 24, 32, 48, 64)
- Implement skeleton loading states
- Use proper ARIA labels for accessibility
- Support keyboard navigation

### Animation Guidelines

- Page transitions: 200ms ease-out
- Hover states: 150ms ease
- Modals: 300ms cubic-bezier(0.16, 1, 0.3, 1)
- Use CSS transforms over opacity for performance

## State Management

### Client State
- React Hook Form for form state
- React Context for auth state (Firebase Auth)
- Local state for UI state

### Server State
- Firestore real-time subscriptions via custom hooks
- Optimistic updates for better UX

### Form Validation
- Zod schemas for validation
- Server-side validation via Firestore security rules

## Performance Guidelines

1. **Code Splitting**: Next.js automatic route-based code splitting
2. **Image Optimization**: Next.js Image component
3. **Font Optimization**: next/font for IBM Plex Sans Arabic
4. **Bundle Analysis**: Run `npm run build` and check bundle size
5. **Lazy Loading**: Dynamic imports for heavy components

## Accessibility

- WCAG 2.1 AA compliance target
- Proper heading hierarchy (h1 → h6)
- Focus indicators on all interactive elements
- Screen reader friendly labels
- Color contrast ratio minimum 4.5:1

## Testing Strategy

### Unit Tests (Jest)
- Component rendering
- Utility functions
- Form validation

### E2E Tests (Playwright)
- Critical user flows
- Authentication flows
- Navigation

### Manual Testing
- Browser compatibility
- Mobile devices
- Accessibility

## Deployment

### Environment Variables
```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_GEMINI_API_KEY=
```

### Build & Deploy
```bash
npm run build
firebase deploy --only hosting
```

## Best Practices

1. **Component Composition**: Prefer composition over inheritance
2. **Colocation**: Keep related files together
3. **Type Safety**: Use TypeScript strictly, avoid `any`
4. **Error Boundaries**: Implement error boundaries for graceful failures
5. **Loading States**: Always show loading states for async operations
6. **Error Handling**: Show user-friendly error messages
7. **Security**: Never expose sensitive data in client-side code

## Scripts Reference

```bash
# Development
npm run dev              # Start dev server on port 9002

# Build
npm run build            # Production build
npm run start            # Start production server
npm run lint             # Run ESLint
npm run typecheck        # Run TypeScript check

# Testing
npm run test             # Run Jest tests
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
npm run e2e              # Run Playwright tests
npm run e2e:ui           # Playwright UI mode

# AI Development
npm run genkit:dev       # Start Genkit dev server
npm run genkit:watch     # Watch mode for AI flows
```

## Troubleshooting

### Common Issues

1. **Build Errors**: Run `npm run typecheck` to see type errors
2. **Firestore Issues**: Check firestore.rules and ensure proper permissions
3. **Auth Issues**: Verify Firebase Auth configuration in console
4. **UI Issues**: Check Tailwind configuration and CSS imports

### Debug Mode

Add to `.env.local`:
```env
NEXT_PUBLIC_DEBUG=true
```