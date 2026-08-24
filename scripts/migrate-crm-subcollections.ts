import { config as loadEnv } from 'dotenv';
import { initializeApp, cert, applicationDefault, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Moves legacy CRM opportunities and quotations out of their per-contact
// subcollections and into the top-level `crmOpportunities` / `crmQuotations`
// collections the pipeline pages read.
//
// Before: crmContacts/{contactId}/opportunities/{id}
//         crmContacts/{contactId}/quotations/{id}
// After:  crmOpportunities/{id}  (+ contactId, contactName)
//         crmQuotations/{id}     (+ contactId, contactName)
//
// The subcollection documents are LEFT IN PLACE — this script only copies, so
// a bad run is undone by deleting the top-level docs. Re-running is safe: a
// document that already exists at the destination is skipped, not duplicated.
//
// Credentials, in order: a service-account key file in the project root
// (GOOGLE_APPLICATION_CREDENTIALS, service-account.json, or the downloaded
// *firebase-adminsdk*.json), then the same env vars the app's server code uses
// (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in
// .env.local — see src/lib/firebaseAdmin.ts), then Application Default
// Credentials. If a key file and the env vars name different projects the run
// aborts rather than guessing which database to write to.
//
// To run:
//   npm run migrate:crm            # copy only, prints what it would change
//   npm run migrate:crm -- --dry-run
//   npm run migrate:crm -- --delete-legacy   # remove subcollection docs after copying

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const deleteLegacy = process.argv.includes('--delete-legacy');
const dryRun = process.argv.includes('--dry-run');

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
    // about which project that is, stop rather than guess — picking the wrong
    // one would copy documents into the wrong database.
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

const db = getFirestore(initAdminApp());

const MIGRATIONS = [
  { sub: 'opportunities', target: 'crmOpportunities' },
  { sub: 'quotations', target: 'crmQuotations' },
] as const;

async function migrate() {
  console.log('🚀 Migrating CRM subcollections to top-level collections...');
  if (dryRun) console.log('🔎 --dry-run: nothing will be written.');
  else if (deleteLegacy) console.log('⚠️  --delete-legacy: subcollection documents will be removed after copying.');

  const contacts = await db.collection('crmContacts').get();
  console.log(`📇 ${contacts.size} contact(s) to walk.\n`);

  let copied = 0;
  let skipped = 0;
  let orphaned = 0;

  for (const contact of contacts.docs) {
    const contactData = contact.data();
    const organizationId = contactData.organizationId;
    const contactName = contactData.name ?? null;

    if (!organizationId) {
      console.warn(`  ⏭️  ${contact.id} has no organizationId — skipping its subcollections.`);
      orphaned++;
      continue;
    }

    for (const { sub, target } of MIGRATIONS) {
      const legacy = await contact.ref.collection(sub).get();
      if (legacy.empty) continue;

      let copiedHere = 0;
      let skippedHere = 0;

      for (const legacyDoc of legacy.docs) {
        const destination = db.collection(target).doc(legacyDoc.id);
        if ((await destination.get()).exists) {
          skippedHere++;
          skipped++;
          continue;
        }

        if (!dryRun) {
          await destination.set({
            ...legacyDoc.data(),
            contactId: contact.id,
            contactName,
            // The subcollection rules trusted the parent contact for ownership;
            // the top-level collection needs it on the document itself.
            organizationId,
          });
          if (deleteLegacy) await legacyDoc.ref.delete();
        }
        copiedHere++;
        copied++;
      }

      console.log(
        `  ✅ ${contactName ?? contact.id} / ${sub}: ${copiedHere} copied, ${skippedHere} already migrated.`
      );
    }
  }

  console.log(`\n🎉 Done. ${copied} copied, ${skipped} already present, ${orphaned} contact(s) skipped.`);
  if (copied === 0 && skipped === 0) {
    console.log('ℹ️  No legacy subcollection documents found — nothing to migrate.');
  } else if (!dryRun && !deleteLegacy) {
    console.log('ℹ️  Legacy subcollection documents were kept. Re-run with --delete-legacy once you have verified the result.');
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
