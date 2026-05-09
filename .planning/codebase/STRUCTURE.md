# STRUCTURE.md

## Directory Layout

### `.planning/`
- Contains GSD planning artifacts, requirements, and codebase map.

### `docs/`
- Project documentation, setup guides, and system design blueprints.

### `scripts/`
- PowerShell and JavaScript scripts for CI/CD, validation, and project health checks.

### `src/`
- **`app/`**: Next.js App Router pages and layouts.
  - `(admin)/`: Admin-only routes.
  - `(contractor)/`: Contractor-only routes.
  - `(supplier)/`: Supplier-only routes.
  - `chat/`: Real-time chat functionality.
  - `login/`, `register/`: Auth pages.
- **`components/`**: React components.
  - `ui/`: Base Shadcn-like UI components.
  - `layout/`: Shared layouts (Portal, Sidebar).
  - `contractor/`, `supplier/`, `admin/`: Role-specific components.
- **`firebase/`**: Firebase initialization and custom hooks.
- **`ai/`**: Genkit configuration and AI flows.
- **`lib/`**: Utility libraries and shared logic.
- **`hooks/`**: Custom React hooks (e.g., `use-toast`).
- **`utils/`**: Helper functions.

### `public/`
- Static assets (images, fonts).

### `e2e/`
- Playwright end-to-end tests.

### `__tests__`
- Jest unit and integration tests.
