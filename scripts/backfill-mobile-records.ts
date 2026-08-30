import { config as loadEnv } from 'dotenv';
import { initializeApp, cert, applicationDefault, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Repairs documents written by the mobile app before it was synced with this
// website. Each fix targets one field the website queries or resolves on, and
// whose absence made an otherwise-valid record invisible here:
//
//  1. rfqs missing `visibility`
//       The supplier feed queries `where("visibility", "==", "public")`, so an
//       RFQ published from the old mobile app reached no supplier at all.
//       -> set visibility "public" and an empty allowedSupplierOrgIds.
//
//  2. rfqs with `boqItems` but no `products`
//       The website renders line items from `products`; these RFQs showed as
//       having none. -> derive products from boqItems, leaving boqItems alone.
//
//  3. offers missing `contractorOrgId`
//       Contractor notifications, work queue, receipts, goods-received and
//       guarantees all query offers by contractorOrgId, so these offers never
//       surfaced anywhere except the RFQ's own detail page.
//       -> copy it from the offer's RFQ.
//
//  4. users whose `organizationId` is a generated id rather than their uid
//       The old mobile sign-up minted a random organization id. The website
//       reads that as a SECONDARY company and resolves its identity from
//       organizations/{organizationId} — a doc that was never created — so the
//       whole company profile (name, CR number, phone, city, ...) rendered
//       blank. -> create the missing organizations/{id} doc from the user's own
//       identity fields.
//
//       This is deliberately additive. The alternative repair — rewriting
//       organizationId back to the uid — would have to rewrite it on every rfq,
//       offer and chat that account has already created, and a half-finished run
//       would orphan them. Creating the missing doc leaves every existing
//       reference valid, and is undone by deleting the doc again.
//
// Every fix is idempotent: a document that already has the field is skipped,
// never overwritten. Re-running is safe.
//
// Credentials, in order: a service-account key file in the project root
// (GOOGLE_APPLICATION_CREDENTIALS, service-account.json, or the downloaded
// *firebase-adminsdk*.json), then the same env vars the app's server code uses
// (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in
// .env.local), then Application Default Credentials. If a key file and the env
// vars name different projects the run aborts rather than guessing.
//
// To run:
//   npm run backfill:mobile                  # dry run — reports, writes nothing
//   npm run backfill:mobile -- --apply       # actually write
//   npm run backfill:mobile -- --apply --only=offer-org
//
// --only accepts: rfq-visibility, rfq-products, offer-org, user-org

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const apply = process.argv.includes('--apply');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : null;

const FIXES = ['rfq-visibility', 'rfq-products', 'offer-org', 'user-org'] as const;
type Fix = (typeof FIXES)[number];

function enabled(fix: Fix): boolean {
  return !only || only.includes(fix);
}

if (only) {
  const unknown = only.filter((o) => !FIXES.includes(o as Fix));
  if (unknown.length > 0) {
    console.error(`❌ Unknown --only value(s): ${unknown.join(', ')}. Valid: ${FIXES.join(', ')}`);
    process.exit(1);
  }
}

interface ServiceAccountKey {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

/**
 * Locate a service-account JSON in the project root, in order of how
 * explicitly it was chosen: GOOGLE_APPLICATION_CREDENTIALS, the conventional
 * service-account.json, then whatever `*firebase-adminsdk*.json` the Firebase
 * console downloaded (its filename carries the project id, so it varies).
 */
function findKeyFile(): string | null {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (explicit && existsSync(explicit)) return explicit;

  const conventional = resolve(process.cwd(), 'service-account.json');
  if (existsSync(conventional)) return conventional;

  const downloaded = readdirSync(process.cwd())
    .filter((name) => name.includes('firebase-adminsdk') && name.endsWith('.json'))
    .sort();
  return downloaded.length > 0 ? resolve(process.cwd(), downloaded[0]) : null;
}

function initAdminApp(): App {
  const envProjectId = process.env.FIREBASE_PROJECT_ID;
  const envClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const envPrivateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const hasEnvCredentials = !!(envProjectId && envClientEmail && envPrivateKey);

  const keyFilePath = findKeyFile();
  if (keyFilePath) {
    const key = JSON.parse(readFileSync(keyFilePath, 'utf8')) as ServiceAccountKey;
    const { project_id: projectId, client_email: clientEmail, private_key: privateKey } = key;

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(`${keyFilePath} is not a valid service-account key (missing project_id/client_email/private_key).`);
    }

    // This script WRITES to production. If the two credential sources disagree
    // about which project that is, stop rather than guess.
    if (hasEnvCredentials && envProjectId !== projectId) {
      throw new Error(
        `Credential mismatch: ${keyFilePath} targets "${projectId}" but FIREBASE_PROJECT_ID is "${envProjectId}". ` +
          `Remove one of them, or set GOOGLE_APPLICATION_CREDENTIALS to the key you mean to use.`
      );
    }

    console.log(`🔑 Using service-account key file ${keyFilePath} (project: ${projectId}).`);
    return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }

  if (hasEnvCredentials) {
    console.log(`🔑 Using service-account env vars (project: ${envProjectId}).`);
    return initializeApp({
      credential: cert({ projectId: envProjectId, clientEmail: envClientEmail, privateKey: envPrivateKey }),
    });
  }

  console.log('🔑 Using application default credentials.');
  return initializeApp({ credential: applicationDefault(), projectId: envProjectId });
}

const db: Firestore = getFirestore(initAdminApp());

interface BoqItem {
  description?: string;
  unit?: string;
  quantity?: number | string;
  specs?: string;
}

/** Same mapping the mobile app now applies at write time (lib/contracts.ts). */
function productsFromBoqItems(items: BoqItem[], category: string) {
  return items.map((item) => ({
    name: item.description ?? '',
    quantity: Number(item.quantity) || 0,
    unitOfMeasure: item.unit ?? '',
    description: item.specs ?? '',
    category,
    subCategory: '',
    requiresWarranty: false,
  }));
}

// Company-identity fields, matching src/lib/identity-fields.ts. Only these are
// copied onto the organization doc — role and org bookkeeping stay on the user.
const IDENTITY_FIELD_KEYS = [
  'name', 'companyName', 'crNumber', 'taxNumber', 'city', 'location',
  'phone', 'phoneNumber', 'description', 'website', 'certificates',
  'legalDocuments', 'documents', 'isVerified', 'verified', 'profileCompleted',
  'specializations', 'coverageCities', 'serviceAreas', 'projects',
  'companyFiles', 'verificationRequested',
];

async function fixRfqs() {
  const snap = await db.collection('rfqs').get();
  let visibilityFixed = 0;
  let productsFixed = 0;
  let untouched = 0;

  for (const rfqDoc of snap.docs) {
    const data = rfqDoc.data();
    const update: Record<string, unknown> = {};

    if (enabled('rfq-visibility') && data.visibility == null) {
      update.visibility = 'public';
      if (!Array.isArray(data.allowedSupplierOrgIds)) update.allowedSupplierOrgIds = [];
    }

    if (
      enabled('rfq-products') &&
      (!Array.isArray(data.products) || data.products.length === 0) &&
      Array.isArray(data.boqItems) &&
      data.boqItems.length > 0
    ) {
      update.products = productsFromBoqItems(data.boqItems as BoqItem[], data.category ?? '');
    }

    if (Object.keys(update).length === 0) {
      untouched++;
      continue;
    }
    if ('visibility' in update) visibilityFixed++;
    if ('products' in update) productsFixed++;

    console.log(`  rfq ${rfqDoc.id} (${data.title ?? 'untitled'}): + ${Object.keys(update).join(', ')}`);
    if (apply) await rfqDoc.ref.update(update);
  }

  console.log(`\n📋 rfqs: ${visibilityFixed} given visibility, ${productsFixed} given products, ${untouched} already fine.`);
}

async function fixOffers() {
  if (!enabled('offer-org')) return;

  const snap = await db.collection('offers').get();
  // One read per distinct RFQ rather than one per offer.
  const rfqOrgCache = new Map<string, string | null>();
  let fixed = 0;
  let unresolved = 0;
  let untouched = 0;

  for (const offerDoc of snap.docs) {
    const data = offerDoc.data();
    if (data.contractorOrgId != null) {
      untouched++;
      continue;
    }

    const rfqId: string | undefined = data.rfqId;
    if (!rfqId) {
      console.warn(`  ⏭️  offer ${offerDoc.id} has no rfqId — cannot resolve its contractor org.`);
      unresolved++;
      continue;
    }

    if (!rfqOrgCache.has(rfqId)) {
      const rfq = await db.collection('rfqs').doc(rfqId).get();
      const rfqData = rfq.data();
      rfqOrgCache.set(rfqId, rfq.exists ? (rfqData?.organizationId ?? rfqData?.contractorId ?? null) : null);
    }
    const contractorOrgId = rfqOrgCache.get(rfqId) ?? null;

    if (!contractorOrgId) {
      console.warn(`  ⏭️  offer ${offerDoc.id}: rfq ${rfqId} is missing or has no organizationId.`);
      unresolved++;
      continue;
    }

    console.log(`  offer ${offerDoc.id}: + contractorOrgId ${contractorOrgId}`);
    if (apply) await offerDoc.ref.update({ contractorOrgId });
    fixed++;
  }

  console.log(`\n💰 offers: ${fixed} given contractorOrgId, ${unresolved} unresolved, ${untouched} already fine.`);
}

async function fixUserOrgs() {
  if (!enabled('user-org')) return;

  const snap = await db.collection('users').get();
  let created = 0;
  let untouched = 0;

  for (const userDoc of snap.docs) {
    const data = userDoc.data();
    const organizationId: string | undefined = data.organizationId;

    // Only owners with an organizationId that isn't their uid — the exact shape
    // the website treats as a secondary company.
    const isSecondary =
      !!organizationId && organizationId !== userDoc.id && data.organizationRole !== 'member';
    if (!isSecondary) {
      untouched++;
      continue;
    }

    // A genuine secondary company already has its doc; leave it alone.
    const orgRef = db.collection('organizations').doc(organizationId!);
    if ((await orgRef.get()).exists) {
      untouched++;
      continue;
    }

    const identity: Record<string, unknown> = {};
    for (const key of IDENTITY_FIELD_KEYS) {
      if (data[key] !== undefined) identity[key] = data[key];
    }

    console.log(
      `  user ${userDoc.id} (${data.email ?? 'no email'}): creating organizations/${organizationId} ` +
        `with ${Object.keys(identity).length} identity field(s)`
    );
    if (apply) {
      await orgRef.set({
        ...identity,
        name: data.companyName ?? data.orgName ?? data.name ?? '',
        ownerUserId: userDoc.id,
        role: data.role ?? null,
        // Marks the doc as a repair rather than a company the user added, in
        // case this needs to be identified or reverted later.
        createdByBackfill: true,
        createdAt: new Date().toISOString(),
      });
    }
    created++;
  }

  console.log(`\n👤 users: ${created} missing organization doc(s) created, ${untouched} already fine.`);
}

async function run() {
  console.log('🚀 Backfilling records written by the pre-sync mobile app...');
  if (only) console.log(`🎯 --only=${only.join(',')}`);
  if (!apply) console.log('🔎 Dry run — nothing will be written. Re-run with --apply to commit.\n');
  else console.log('✍️  --apply: changes WILL be written.\n');

  if (enabled('rfq-visibility') || enabled('rfq-products')) await fixRfqs();
  await fixOffers();
  await fixUserOrgs();

  console.log(apply ? '\n🎉 Done.' : '\n🎉 Dry run complete — re-run with --apply to commit these changes.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  });
