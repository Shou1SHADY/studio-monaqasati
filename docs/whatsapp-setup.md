# WhatsApp Notifications — Setup Runbook

The code is fully wired: when a contractor publishes an RFQ, every supplier in
their favorites gets a direct message. Delivery tries **WhatsApp first** (Meta
Cloud API — works to Saudi numbers), then falls back to **SMS via Twilio**
(works to Egypt and most countries, but NOT to +966 from our +1 number —
Twilio error 21612).

Nothing ships until the environment variables below exist. Everything else is
already deployed.

## What the code expects

| Variable | Where it comes from | Secret? |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Meta app → WhatsApp → API Setup | no |
| `WHATSAPP_ACCESS_TOKEN` | Same page (temporary) or System User (permanent) | **yes** |
| `WHATSAPP_TEMPLATE_NAME` | Optional — name of the approved template | no |
| `WHATSAPP_TEMPLATE_LANG` | Optional — defaults to `ar` | no |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | Twilio console (already set locally) | token: **yes** |

Local dev: `.env.local`. Production: the Vercel project → Settings →
Environment Variables (the project is under a teammate's Vercel account).

## One-time Meta setup (needs a Facebook account)

1. **developers.facebook.com** → log in → register as developer (accept terms).
2. My Apps → **Create App** → use case *Other* → type **Business** →
   name `Mdmak Tech` → create/select the **Mdmak Tech** business portfolio.
3. App dashboard → **WhatsApp → Set up**. The **API Setup** page now shows:
   - a free **test number** — good for development immediately
   - **Phone number ID** → becomes `WHATSAPP_PHONE_NUMBER_ID`
   - a temporary **access token** (24h) → becomes `WHATSAPP_ACCESS_TOKEN`
4. "To" field → **Manage phone number list** → add the tester's own mobile,
   confirm the WhatsApp code.
5. The tester sends any message to the test number from WhatsApp — this opens
   a 24-hour session so plain-text messages deliver during testing.

## Going to production (after the test works)

1. **Real number:** WhatsApp → API Setup → *Add phone number* — use a number
   NOT already registered on a WhatsApp app (it gets converted). Complete
   Meta **business verification** for the Mdmak Tech portfolio
   (business.facebook.com → Security Centre) — usually 1–3 days.
2. **Template:** business-initiated messages to people who haven't written to
   you first REQUIRE an approved template. Create it under WhatsApp Manager →
   Message templates, category **Utility**, language Arabic, e.g.:

   > name: `rfq_published` — body: `{{1}}`

   (a single-variable body keeps the code unchanged — the app fills the whole
   message text as `{{1}}`). Approval is usually minutes to hours. Then set
   `WHATSAPP_TEMPLATE_NAME=rfq_published`.
3. **Permanent token:** business.facebook.com → Business settings → Users →
   **System users** → add one (admin), assign the app with full control →
   Generate token with `whatsapp_business_messaging` +
   `whatsapp_business_management` permissions, expiry *never*. Replace the
   temporary `WHATSAPP_ACCESS_TOKEN` with it.
4. Add all variables to **Vercel → Settings → Environment Variables →
   Production** and redeploy.

## Where the code lives

- `src/lib/sms.ts` — `sendWhatsApp` (Meta Cloud API), `sendSms` (Twilio),
  `sendDirectMessage` (WhatsApp-first with SMS fallback), `normalizePhoneE164`
- `src/app/api/rfq-published/notify-favorites/route.ts` — the publish hook:
  favorites resolution, private-RFQ audience filtering, per-supplier dedupe
  (`smsNotifiedSupplierIds` on the RFQ doc)
- `src/lib/notify-favorites.ts` — fire-and-forget client call, wired into all
  six publish paths
- Tests: `src/__tests__/sms-normalize.test.ts`, `src/__tests__/sms-channels.test.ts`
