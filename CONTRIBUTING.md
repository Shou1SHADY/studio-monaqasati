# Contributing to مناقصتي

## Welcome

Thank you for contributing to مناقصتي! This guide will help you get started.

## Code Style

### TypeScript
- Use strict TypeScript mode
- Avoid `any` - use `unknown` or proper types
- Use interfaces over types for object shapes
- Add JSDoc for complex functions

### React/Next.js
- Use functional components with hooks
- Follow Next.js App Router conventions
- Use proper TypeScript for props

### CSS/Tailwind
- Use Tailwind utility classes
- Follow design tokens in `tailwind.config.ts`
- Keep custom CSS to a minimum

## File Organization

```
src/
├── app/           # Pages (Next.js App Router)
├── components/   # Reusable components
│   ├── ui/       # Base UI components
│   └── layout/   # Layout components
├── firebase/     # Firebase logic
├── hooks/        # Custom hooks
├── lib/          # Utilities
└── ai/           # AI/Genkit flows
```

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `UserProfile.tsx` |
| Hooks | camelCase with "use" | `useAuth.ts` |
| Utilities | PascalCase | `utils.ts` |
| Types/Interfaces | PascalCase | `UserProfile` |
| Constants | UPPER_SNAKE | `MAX_UPLOAD_SIZE` |

## Commit Messages

Follow conventional commits:
```
feat: add new login page
fix: resolve authentication issue
docs: update API documentation
refactor: simplify user validation
test: add tests for RFQ creation
chore: update dependencies
```

## Pull Request Process

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/my-feature`
3. **Make** your changes
4. **Run** checks:
   ```bash
   npm run check:quick
   ```
5. **Commit** with clear messages
6. **Push** to your fork
7. **Create** a Pull Request

## Pre-commit Checklist

- [ ] TypeScript compiles without errors
- [ ] ESLint passes
- [ ] Tests pass
- [ ] Build succeeds
- [ ] No secrets in code
- [ ] Documentation updated (if needed)

## Running Checks

```bash
# Quick check (recommended before commit)
npm run check:quick

# Full check
npm run check:all

# Individual checks
npm run check:code      # TypeScript + ESLint
npm run check:tests     # All tests
npm run check:security   # Security audit
npm run check:ui         # UI/UX check
npm run check:arch      # Architecture check
```

## Architecture Principles

1. **Authorization Independence** - Denormalize IDs for security rules
2. **Role-Based Access** - Use route groups for admin/contractor/supplier
3. **Component Composition** - Prefer composition over inheritance
4. **Type Safety** - Use TypeScript strictly
5. **Error Handling** - Graceful failures with user feedback

## UI/UX Guidelines

- Follow RTL design (Arabic first)
- Use design tokens from `tailwind.config.ts`
- Implement loading states
- Handle errors gracefully
- Follow accessibility best practices
- Use consistent spacing (4px grid)

## Documentation

Update docs when:
- Adding new features
- Changing API endpoints
- Modifying architecture
- Creating new components

Docs locations:
- `docs/frontend/ARCHITECTURE.md`
- `docs/backend/ARCHITECTURE.md`
- `docs/api/API.md`
- Inline code comments

## Questions?

- Open an issue for bugs/features
- Check existing issues before creating new ones
- Be respectful and constructive

---

Thank you for contributing! ❤️