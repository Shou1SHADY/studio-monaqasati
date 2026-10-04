---
name: rtl-audit
description: Audit a new or changed screen for RTL-first layout, bilingual strings, accessibility and mobile fit on Studio Monaqasati. Use before committing any UI change, when asked to check a page in Arabic and English, or when a screen looks wrong in one locale.
allowed-tools: Read, Edit, Bash, Grep, Glob
---

# RTL, i18n and accessibility audit

Arabic (RTL) is the primary locale. A screen is not done until it holds up in Arabic, English and at 375px. Run the static pass on every changed UI file, then the browser pass when the screen is reachable.

## 1. Static pass (changed files only)

Get the files: `git diff --name-only HEAD -- 'src/**/*.tsx'` plus untracked ones from `git status --short`. Then grep them:

```bash
# physical direction: should be logical (ms/me/ps/pe/start/end, text-start/text-end, border-s/border-e, rounded-s/rounded-e)
grep -nE '\b(ml|mr|pl|pr)-[0-9]|\b(left|right)-[0-9]|text-(left|right)|\bborder-(l|r)\b|rounded-(l|r)-' <files>
# arbitrary colours: use tokens (primary, accent, cta, success, secondary, muted, destructive, module)
grep -nE '\[#[0-9a-fA-F]{3,8}\]' <files>
# wrong link and image primitives
grep -nE 'from "next/link"|<img ' <files>
# letter-spacing on text that can be Arabic (only .tracking-latin on Latin-only strings)
grep -nE 'tracking-|letter-spacing' <files>
# clickable divs
grep -nE '<div[^>]*onClick' <files>
```

Judge each hit:

- A `text-right` or `right-3` is a bug unless the element is intentionally fixed to the physical side (a chart axis, a phone number with `dir="ltr"`). Replace with `text-start` / `end-3`; swap `pl-3 pr-9` for `ps-3 pe-9`. An icon that points a direction gets `.rtl-flip`.
- Numbers, emails, phone numbers and codes: `dir="ltr"` on the element so they do not reorder inside Arabic text.
- Dynamic text containers (names typed by users): `dir="auto"`.
- Pre-existing hits in a file you did not change are reported, not fixed, unless the owner asks.

## 2. Strings

- No literal Arabic or English in JSX. Every key is in `messages/ar.json` AND `messages/en.json` under the same namespace.
- `node scripts/check-i18n-links.mjs` must report 0 missing, 0 one-language, 0 dead links.
- Read the Arabic: natural wording, not a literal translation; no Latin punctuation inside Arabic sentences where Arabic punctuation exists.
- Plurals use next-intl plural rules (Arabic has six forms). Dates through `date-fns` with the locale.

## 3. Accessibility pass (read the JSX)

- Icon-only buttons have `aria-label`. Every input has a `<label htmlFor>`.
- Every interactive element has a visible focus ring (`focus-visible:ring-2 ring-ring ring-offset-2`), a hover state and a disabled state.
- One `<h1>` per page. Images use `next/image` with `alt` in the page language, `alt=""` if decorative.
- Dialogs have a `DialogTitle` and `DialogDescription`.
- Touch targets are at least 44px on mobile. Text contrast is at least 4.5:1; status colours are never the only signal (add text or an icon).
- Forms use react-hook-form plus zod, show errors on blur or submit, and disable submit while submitting.

## 4. Browser pass (built-in browser, `mcp__Claude_Browser__*`)

The owner signs in; never type passwords. If the screen needs a role, ask them to sign in in the Browser pane, then:

1. Open the page at `/<path>` (Arabic) and `/en/<path>` (English). Compare alignment, icon direction, table column order, and where dialogs open.
2. `resize_window` preset `mobile` (375x812), reload, check there is no horizontal scroll and nothing is clipped. Reset with preset `desktop` when done.
3. `read_console_messages` with `onlyErrors`: no hydration or missing-translation errors.
4. Open each dialog and the empty, loading and error states, not only the filled one.
5. Screenshot only when the layout is the point; prefer `read_page` / `get_page_text` for text.

For the local app use `preview_start` with name "Studio Monaqasati" from `.claude/launch.json` (port 9002). UAT: `https://studio-monaqasati--mdmaktech-uat.us-east4.hosted.app`. Never submit irreversible test actions without the owner's OK.

## 5. Report

List findings as file:line with the fix, split into "fixed in this change" and "pre-existing, not touched". If everything passes, one sentence. If the browser pass could not run (no sign-in), say so instead of claiming the screen was checked.
