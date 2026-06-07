// Script to delete all documents in the 'offers' Firestore collection
// Run with: node scripts/delete-offers.mjs

import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc, doc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBLc-jwwFrCiklo8h9UCH9dIgF2ALUQCLw",
  authDomain: "studio-2889504658-6ee2a.firebaseapp.com",
  projectId: "studio-2889504658-6ee2a",
  storageBucket: "studio-2889504658-6ee2a.firebasestorage.app",
  messagingSenderId: "374877124985",
  appId: "1:374877124985:web:c7e928b56b265e9a2597a8",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function deleteAllOffers() {
  console.log("🔍 Fetching all documents in 'offers' collection...");
  const snapshot = await getDocs(collection(db, "offers"));

  if (snapshot.empty) {
    console.log("✅ The 'offers' collection is already empty.");
    process.exit(0);
  }

  console.log(`🗑  Found ${snapshot.size} offer(s). Deleting...`);

  const deletePromises = snapshot.docs.map((d) => {
    console.log(`  - Deleting offer: ${d.id}`);
    return deleteDoc(doc(db, "offers", d.id));
  });

  await Promise.all(deletePromises);

  console.log(`✅ Successfully deleted ${snapshot.size} offer(s) from Firestore.`);
  process.exit(0);
}

deleteAllOffers().catch((err) => {
  console.error("❌ Error deleting offers:", err);
  process.exit(1);
});
