# Procurement — boundaries, links and what is not built

Superseded on 21 Oct 2026 (Procurement 2.0). The team's reference is now the admin portal's «المسار والعقود» (`/admin/pipeline`): the six stages by connector, the eight rules, the 36 events with their idempotency keys, and the eight states. It reads one registry, `src/lib/procurement/package-data.ts` (events, stages, rules) and `package.ts` (the package), so this file is no longer a copy of it. The customer's screens carry none of these texts (SET-05, B-12).
