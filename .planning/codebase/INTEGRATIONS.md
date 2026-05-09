# INTEGRATIONS.md

## External Services

### Firebase
- **Authentication**: Used for user login (Email/Password, potentially Phone OTP).
- **Firestore**: Primary NoSQL database for users, RFQs, offers, notifications, etc.
- **Storage**: Used for profile documents, certificates, and RFQ attachments.
- **App Hosting**: Production environment for the Next.js application.

### Google GenAI (via Genkit)
- **Model**: Google Gemini (via `@genkit-ai/google-genai`).
- **Use Cases**:
  - Drafting RFQ descriptions (`draft-rfq-description-flow.ts`).
  - Recommending RFQs for suppliers (`recommend-rfq-for-supplier-flow.ts`).
  - Recommending suppliers for RFQs (`recommend-suppliers-for-rfq-flow.ts`).
  - Suggesting supplier specializations (`suggest-supplier-specializations-flow.ts`).

### Maps
- **Leaflet / OpenStreetMap**: Used for location picking and display in profiles and RFQs.

## Internal APIs
- **Next.js API Routes**: (Implicitly used if any, though Firebase SDK is used directly on the client).
- **Genkit Flows**: Exposed as server actions or API endpoints for AI-powered features.
