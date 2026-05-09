# TESTING.md

## Test Suites

### Unit & Integration Testing (Jest)
- **Framework**: Jest + `ts-jest` + `next/jest`.
- **Environment**: `jsdom` for React component testing.
- **Location**: `src/__tests__` and adjacent `.test.ts(x)` files.
- **Commands**:
  - `npm run test`: Run all Jest tests.
  - `npm run test:watch`: Run tests in watch mode.
  - `npm run test:coverage`: Generate coverage reports.

### End-to-End Testing (Playwright)
- **Framework**: Playwright.
- **Location**: `e2e/`.
- **Commands**:
  - `npm run e2e`: Run Playwright tests.
  - `npm run e2e:ui`: Open Playwright UI.

## Testing Patterns
- **Mocking**: Firebase logic is often mocked to avoid real database calls during unit tests.
- **Accessibility**: Testing for ARIA attributes and RTL layout support.
- **AI Testing**: Genkit flows have dedicated tests (e.g., `src/ai/cache.test.ts`).

## Quality Gates
- **Scripts**: `scripts/validate-app.ps1` runs a full validation suite (typecheck, lint, test, build).
- **Checks**: Specific scripts for `code-quality`, `security`, `ui-ux`, and `architecture` in `scripts/checks/`.
