// Deletes ALL documents in the 'rfqs' collection from Firestore.
// Run with: node scripts/delete-rfqs.mjs
// Add --dry-run flag to preview without deleting.

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  deleteDoc,
  doc,
  writeBatch,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBLc-jwwFrCiklo8h9UCH9dIgF2ALUQCLw",
  authDomain: "studio-2889504658-6ee2a.firebaseapp.com",
  projectId: "studio-2889504658-6ee2a",
  storageBucket: "studio-2889504658-6ee2a.firebasestorage.app",
  messagingSenderId: "374877124985",
  appId: "1:374877124985:web:c7e928b56b265e9a2597a8",
};

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 499; // Firestore batch write limit

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function deleteAllRfqs() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no deletions)" : "LIVE"}`);
  console.log("Fetching all documents in 'rfqs' collection...");

  const snapshot = await getDocs(collection(db, "rfqs"));

  if (snapshot.empty) {
    console.log("The 'rfqs' collection is already empty.");
    process.exit(0);
  }

  console.log(`Found ${snapshot.size} RFQ(s).`);

  if (DRY_RUN) {
    snapshot.docs.forEach((d) => {
      const data = d.data();
      console.log(`  [DRY RUN] Would delete: ${d.id}  title="${data.title ?? "(no title)"}"  status="${data.status ?? "?"}"  createdAt="${data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt ?? "?"}"`);
    });
    console.log(`\nDry run complete. ${snapshot.size} RFQ(s) would be deleted.`);
    process.exit(0);
  }

  // Delete in batches of 499
  const docs = snapshot.docs;
  let deleted = 0;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = docs.slice(i, i + BATCH_SIZE);
    chunk.forEach((d) => batch.delete(doc(db, "rfqs", d.id)));
    await batch.commit();
    deleted += chunk.length;
    console.log(`  Deleted ${deleted}/${docs.length}...`);
  }

  console.log(`Successfully deleted ${deleted} RFQ(s) from Firestore.`);
  process.exit(0);
}

deleteAllRfqs().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
