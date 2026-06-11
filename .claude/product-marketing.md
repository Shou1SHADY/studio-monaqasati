# Product & Marketing Context — Mdmak Tech

> This file is auto-loaded by Claude skills like `seo-audit`, `frontend-design`, and `seo` before asking questions.
> Keep it updated. It saves Claude from asking the same onboarding questions every session.

---

## What We Do

**Mdmak Tech** is a **B2B SaaS procurement platform** (منصة مناقصات ذكية) connecting:
- **Contractors** (مقاولون) — post RFQs (طلبات عروض أسعار) for construction materials
- **Suppliers** (موردون) — receive RFQs, submit competitive quotes, win contracts

**Core value prop:** Replace WhatsApp/phone-based procurement with a structured digital platform. Save contractors time, give suppliers more bidding opportunities.

**Market:** Saudi Arabia (primary). GCC expansion planned.

**Domain:** https://mdmaktech.sa  
**Language:** Arabic (primary, RTL), English (secondary)

---

## Business Model

- **Freemium SaaS** — free tier for basic usage, paid subscription for unlimited RFQs/quotes
- **User types:** Contractors, Suppliers, Admins
- **Transaction flow:** Contractor posts RFQ → Suppliers bid → Contractor compares & selects → Deal closed on platform

---

## Target Keywords (SEO Priority)

**Arabic (Primary):**
- مناقصات بناء السعودية
- منصة مناقصات للمقاولين
- عروض أسعار مواد بناء
- موردين مواد بناء السعودية
- مقارنة عروض الموردين

**English (Secondary):**
- B2B construction procurement Saudi Arabia
- RFQ platform contractors suppliers KSA
- construction material sourcing platform
- contractor supplier marketplace Saudi Arabia

**Product categories (high-intent):**
حديد (steel), أسمنت (cement), كهرباء (electrical), تكييف HVAC, دهانات (paints), أدوات صحية (sanitary ware), عزل (insulation), أرضيات (flooring), أبواب (doors)

---

## Brand Voice

- **Tone:** Professional, trustworthy, efficient — like a reliable business partner
- **NOT:** Casual, playful, or consumer-facing
- **Arabic copy:** Formal Modern Standard Arabic (فصحى محايدة) — not dialect
- **English copy:** Professional B2B SaaS tone

---

## Key Pages

| Page | Purpose | Priority |
|---|---|---|
| `/` (home) | Landing/conversion — contractors & suppliers | 🔴 Critical |
| `/about` | Company story & credibility | 🟡 Medium |
| `/pricing` | Subscription plans | 🔴 Critical |
| `/contact` | Lead generation | 🟡 Medium |
| `/(contractor)/` | Contractor dashboard — post RFQs | 🔴 Critical |
| `/(supplier)/` | Supplier dashboard — bid on RFQs | 🔴 Critical |

---

## Competitors

- Traditional procurement: phone/WhatsApp/email (main competitor — habits)
- Billd (US, not KSA-focused)
- Procurify (enterprise, too complex)
- No dominant direct competitor in Saudi construction B2B procurement SaaS

**Differentiation:** Arabic-first, Saudi-market-specific, simple UX for non-tech contractors

---

## Tech Context for SEO

- Next.js 15 App Router — SSR/SSG pages
- Locales: `ar` (default, `/`), `en` (`/en/*`)
- `localePrefix: 'as-needed'` — Arabic has no prefix, English has `/en/`
- Sitemap at `/sitemap.xml` (auto-generated via `src/app/sitemap.ts`)
- Structured data: JSON-LD in `src/components/StructuredData.tsx`
- Firebase hosting (not Vercel)

---

## Current SEO Status

- ✅ Metadata (title, description) — localized in layout.tsx
- ✅ Open Graph + Twitter cards
- ✅ Sitemap.xml
- ✅ Structured data (JSON-LD)
- ✅ robots.txt
- ⚠️ Hreflang — needs verification (next-intl `localePrefix: as-needed` has known Next.js caveats)
- ⚠️ Core Web Vitals — landing page (`content.tsx` is 48KB) may have LCP issues
