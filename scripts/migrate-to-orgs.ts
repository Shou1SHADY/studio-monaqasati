import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// IMPORTANT: This script requires a service account key!
// To run:
// 1. Download service account key from Firebase Console -> Project Settings -> Service Accounts
// 2. Save as 'service-account.json' in the root
// 3. Run: npx tsx scripts/migrate-to-orgs.ts

const serviceAccount = require('../service-account.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function migrate() {
  console.log('🚀 Starting migration to organization-based model...');

  // 1. Migrate Users
  const usersSnapshot = await db.collection('users').get();
  console.log(`👥 Migrating ${usersSnapshot.size} users...`);
  
  const userBatch = db.batch();
  usersSnapshot.forEach(doc => {
    const data = doc.data();
    if (!data.organizationId) {
      userBatch.update(doc.ref, {
        organizationId: doc.id, // Default to user UID
        organizationRole: 'owner', // Default to owner
        updatedAt: new Date().toISOString()
      });
    }
  });
  await userBatch.commit();
  console.log('✅ Users migrated.');

  // 2. Migrate RFQs
  const rfqsSnapshot = await db.collection('rfqs').get();
  console.log(`📄 Migrating ${rfqsSnapshot.size} RFQs...`);
  
  const rfqBatch = db.batch();
  rfqsSnapshot.forEach(doc => {
    const data = doc.data();
    if (!data.organizationId && data.contractorId) {
      rfqBatch.update(doc.ref, {
        organizationId: data.contractorId,
        updatedAt: new Date().toISOString()
      });
    }
  });
  await rfqBatch.commit();
  console.log('✅ RFQs migrated.');

  // 3. Migrate Offers
  const offersSnapshot = await db.collection('offers').get();
  console.log(`💰 Migrating ${offersSnapshot.size} offers...`);
  
  const offerBatch = db.batch();
  offersSnapshot.forEach(doc => {
    const data = doc.data();
    if (!data.organizationId && data.supplierId) {
      offerBatch.update(doc.ref, {
        organizationId: data.supplierId,
        updatedAt: new Date().toISOString()
      });
    }
  });
  await offerBatch.commit();
  console.log('✅ Offers migrated.');

  // 4. Migrate Chats
  const chatsSnapshot = await db.collection('chats').get();
  console.log(`💬 Migrating ${chatsSnapshot.size} chats...`);
  
  const chatBatch = db.batch();
  chatsSnapshot.forEach(doc => {
    const data = doc.data();
    if (!data.contractorOrgId && data.contractorId) {
      chatBatch.update(doc.ref, {
        contractorOrgId: data.contractorId,
        supplierOrgId: data.supplierId,
        updatedAt: new Date().toISOString()
      });
    }
  });
  await chatBatch.commit();
  console.log('✅ Chats migrated.');

  console.log('🎉 Migration complete!');
}

migrate().catch(console.error);
