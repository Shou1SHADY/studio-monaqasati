---
description: UI/UX rules for all frontend components and pages
globs:
  - "src/components/**"
  - "src/app/**"
---

# UI/UX Rules — Studio Monaqasati

## RTL-First Design

- The PRIMARY locale is Arabic (RTL). Design RTL first, then verify LTR.
- Use `dir="auto"` on dynamic text containers
- Directional utilities: `ms-*`/`me-*` instead of `ml-*`/`mr-*`
- Flip icons with `.rtl-flip` class when in `[dir="rtl"]` context
- Test layout at both `dir="rtl"` and `dir="ltr"`

## Component Rules

- Use `cn()` from `@/lib/utils` for all className merging
- All interactive elements MUST have:
  - Focus ring (use `focus-visible:ring-2 ring-ring ring-offset-2`)
  - Hover state
  - Disabled state if applicable
- Use `aria-label` on icon-only buttons
- Avoid `<div onClick>` — use `<button>` for clickable elements

## Tailwind Rules

- Use design tokens ONLY — never arbitrary hex values `[#xxx]`
- Spacing scale: `2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64` (multiples of 4px)
- Border radius: use `rounded-sm` (8px), `rounded-md` (10px), `rounded-lg` (12px)
- Prefer `gap-*` over `space-*` inside flex/grid layouts
- Dark mode via CSS vars — Tailwind dark: prefix when vars aren't available

## Animations (Framer Motion)

- Import from `framer-motion` (already installed)
- Prefer `initial/animate/exit` patterns for mount/unmount
- Use `viewport={{ once: true }}` for scroll-triggered animations
- Keep animation durations: enter 0.3–0.5s, exit 0.2–0.3s
- Use `staggerChildren` for list animations (0.08–0.12s stagger)
- Never animate opacity/transform together with layout shift

## Images

- Always use `next/image` — never `<img>` tags
- Provide `width` + `height` OR `fill` + `sizes`
- `alt` text is MANDATORY — describe the image in the locale language
- For decorative images: `alt=""`

## Typography

- Headings: always a single `<h1>` per page, then `<h2>`/`<h3>` hierarchy
- Arabic headings: `line-height: 1.6` (enforced globally, do not override lower)
- Use `font-body` class for all text — it switches between Noto Sans Arabic and Inter
- Font weights: 400 (body), 500 (medium), 600 (semibold), 700 (bold)

## Forms

- Use `react-hook-form` + `zod` for ALL forms — no uncontrolled inputs
- Show inline validation errors on blur/submit, not on every keystroke
- Disable submit button while `isSubmitting`
- Show loading state (spinner/skeleton) during async operations

## Accessibility

- Color contrast ratio ≥ 4.5:1 for text (WCAG AA)
- All form inputs must have `<label>` — use `htmlFor`
- Use `role` and `aria-*` attributes for custom components
- Skip-to-content link at the top of the page

## Responsive

- Mobile-first breakpoints: `sm:640 md:768 lg:1024 xl:1280`
- All pages must work from 375px (iPhone SE) to 1440px
- Touch targets ≥ 44×44px on mobile
- No horizontal scroll on mobile (enforced by `overflow-x-hidden` on body)
