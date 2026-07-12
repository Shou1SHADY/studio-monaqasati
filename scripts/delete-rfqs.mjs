// Deletes ALL documents in the 'rfqs' collection using the Firebase Admin SDK.
//
// Usage:
//   node scripts/delete-rfqs.mjs --key path/to/service-account.json --dry-run
//   node scripts/delete-rfqs.mjs --key path/to/service-account.json

import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

const KEY_FILE = getArg("--key") ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
const CREATOR_FILTER = getArg("--creator");   // only delete RFQs from this UID
const EXCLUDE_CREATOR = getArg("--exclude");  // delete all EXCEPT this UID

if (!KEY_FILE) {
  console.error(
    "Error: service account key required.\n\n" +
    "  node scripts/delete-rfqs.mjs --key path/to/service-account.json [--creator <uid>] [--exclude <uid>] [--dry-run]\n"
  );
  process.exit(1);
}

// ── Init ──────────────────────────────────────────────────────────────────────

const serviceAccount = JSON.parse(readFileSync(KEY_FILE, "utf8"));

initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();
const auth = getAuth();
const BATCH_SIZE = 499;

// ── Main ──────────────────────────────────────────────────────────────────────

async function resolveNames(uids) {
  const names = {};
  await Promise.all(uids.map(async (uid) => {
    try {
      const doc = await db.collection("users").doc(uid).get();
      if (doc.exists) {
        const d = doc.data();
        const label =
          d.name ||
          d.displayName ||
          d.companyName ||
          d.fullName ||
          d.email ||
          d.phoneNumber;
        names[uid] = label || uid;
      } else {
        // Fall back to Firebase Auth record
        try {
          const authUser = await auth.getUser(uid);
          names[uid] = authUser.displayName || authUser.email || uid;
        } catch {
          names[uid] = uid;
        }
      }
    } catch {
      names[uid] = uid;
    }
  }));
  return names;
}

async function deleteAllRfqs() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no deletions)" : "LIVE DELETE"}`);
  if (CREATOR_FILTER) console.log(`Filter: only RFQs from creator ${CREATOR_FILTER}`);
  if (EXCLUDE_CREATOR) console.log(`Filter: all RFQs EXCEPT from creator ${EXCLUDE_CREATOR}`);
  console.log("Fetching all documents in 'rfqs' collection...");

  const snapshot = await db.collection("rfqs").get();

  if (snapshot.empty) {
    console.log("The 'rfqs' collection is already empty.");
    process.exit(0);
  }

  // Apply filter
  let docs = snapshot.docs;
  if (CREATOR_FILTER) {
    docs = docs.filter((d) => {
      const uid = d.data().contractorId ?? d.data().createdBy ?? d.data().userId;
      return uid === CREATOR_FILTER;
    });
  } else if (EXCLUDE_CREATOR) {
    docs = docs.filter((d) => {
      const uid = d.data().contractorId ?? d.data().createdBy ?? d.data().userId;
      return uid !== EXCLUDE_CREATOR;
    });
  }

  console.log(`Found ${snapshot.size} total RFQ(s), ${docs.length} match filter.`);

  // Resolve creator UIDs to names
  const allCreatorUids = [...new Set(snapshot.docs.map((d) => {
    const data = d.data();
    return data.contractorId ?? data.createdBy ?? data.userId ?? "(unknown)";
  }))];
  const names = await resolveNames(allCreatorUids);

  if (DRY_RUN) {
    const byCreator = {};
    docs.forEach((d) => {
      const data = d.data();
      const title = data.title?.slice(0, 60) ?? "(no title)";
      const status = data.status ?? "?";
      const uid = data.contractorId ?? data.createdBy ?? data.userId ?? "(unknown)";
      const creatorLabel = `${names[uid] ?? uid} (${uid.slice(0, 8)}…)`;
      console.log(`  ${d.id}  creator="${creatorLabel}"  status=${status}  title="${title}"`);
      byCreator[uid] = (byCreator[uid] ?? 0) + 1;
    });
    console.log(`\n── Creator summary (scope: ${CREATOR_FILTER ? "filtered" : "all"}) ──`);
    Object.entries(byCreator)
      .sort((a, b) => b[1] - a[1])
      .forEach(([uid, count]) => console.log(`  "${names[uid] ?? uid}"  uid=${uid}  → ${count} RFQ(s)`));
    console.log(`\nDry run complete — ${docs.length} RFQ(s) would be deleted.`);
    process.exit(0);
  }

  let deleted = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
    console.log(`  Deleted ${deleted}/${docs.length}...`);
  }

  console.log(`Done. ${deleted} RFQ(s) deleted from Firestore.`);
  process.exit(0);
}

deleteAllRfqs().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
