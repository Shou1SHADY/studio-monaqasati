/**
 * Seeds a full demo workflow in the REAL Firebase project (studio-2889504658-6ee2a):
 *   - 1 contractor org owner + 3 team members (finance / supply_chain / viewer groups)
 *   - 1 supplier account
 *   - 1 project with the team assigned
 *   - 2 RFQs under the project
 *   - 1 supplier offer on the first RFQ (left "under review" so you can accept/reject it live)
 *
 * Usage:
 *   npx tsx scripts/seed-demo-workflow.ts
 *
 * Requires FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in .env.local.
 * Writes real Firebase Auth users + Firestore docs. Re-running is safe — accounts/docs
 * that already exist (by email / deterministic id) are reused, not duplicated.
 */

import { config } from "dotenv"
import { resolve } from "path"

config({ path: resolve(process.cwd(), ".env.local") })

import { initializeApp, cert, getApps, applicationDefault } from "firebase-admin/app"
import { getAuth, type Auth } from "firebase-admin/auth"
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore"
import { randomBytes } from "crypto"

// ---- admin init (mirrors src/lib/firebaseAdmin.ts) ----
function initAdmin() {
  if (getApps().length > 0) return getApps()[0]!
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (projectId && clientEmail && privateKey) {
    return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  }
  return initializeApp({ credential: applicationDefault(), projectId })
}

// ---- permission catalog (mirrors src/lib/permissions.ts SEEDED_GROUPS) ----
const ALL_PERMISSION = "*" as const
type SeededGroupKey = "super_admin" | "finance" | "supply_chain" | "viewer"
const SEEDED_GROUPS: Array<{ key: SeededGroupKey; name: string; permissions: string[]; isSystem: boolean }> = [
  { key: "super_admin", name: "مشرف عام", permissions: [ALL_PERMISSION], isSystem: true },
  { key: "finance", name: "المالية", permissions: ["projects.view", "projects.publish", "offers.view", "offers.accept", "invoices.manage", "employees.manage"], isSystem: false },
  { key: "supply_chain", name: "سلاسل الإمداد", permissions: ["projects.view", "rfq.create", "rfq.manage", "offers.view", "suppliers.manage", "deliveries.confirm", "warehouses.manage"], isSystem: false },
  { key: "viewer", name: "مشاهد", permissions: ["projects.view"], isSystem: false },
]
function seededGroupDocId(organizationId: string, key: SeededGroupKey): string {
  return `${organizationId}_${key}`
}

function genPassword(): string {
  // 12 chars, url-safe, no ambiguity issues — meets Firebase Auth min length with margin.
  return randomBytes(9).toString("base64url") + "!A1"
}

interface SeedAccount {
  label: string
  email: string
  password: string
  name: string
  phone: string
  role: "Contractor" | "Supplier"
  organizationRole: "owner" | "member"
  uid?: string
}

async function ensureUser(auth: Auth, acc: SeedAccount): Promise<string> {
  try {
    const existing = await auth.getUserByEmail(acc.email)
    console.log(`  [exists] ${acc.email} -> ${existing.uid}`)
    return existing.uid
  } catch {
    const created = await auth.createUser({
      email: acc.email,
      password: acc.password,
      displayName: acc.name,
      emailVerified: true,
    })
    console.log(`  [created] ${acc.email} -> ${created.uid}`)
    return created.uid
  }
}

async function main() {
  const fbProjectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY

  if (!fbProjectId || !clientEmail || !privateKey) {
    console.error(
      "\nERROR: Firebase Admin credentials not found.\nSet FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env.local.\n"
    )
    process.exit(1)
  }

  const app = initAdmin()
  const auth = getAuth(app)
  const db: Firestore = getFirestore(app)

  console.log(`Connected to Firebase project: ${fbProjectId}\n`)

  // ---------------------------------------------------------------------
  // 1. Accounts
  // ---------------------------------------------------------------------
  const owner: SeedAccount = {
    label: "Team owner (contractor org admin)",
    email: "shady+demo-owner@mdmaktech.sa",
    password: genPassword(),
    name: "أحمد القحطاني",
    phone: "+966501112222",
    role: "Contractor",
    organizationRole: "owner",
  }
  const financeMember: SeedAccount = {
    label: "Team member — Finance group (projects.view, offers.accept, invoices.manage, employees.manage)",
    email: "shady+demo-finance@mdmaktech.sa",
    password: genPassword(),
    name: "سارة العتيبي",
    phone: "+966501112223",
    role: "Contractor",
    organizationRole: "member",
  }
  const supplyMember: SeedAccount = {
    label: "Team member — Supply Chain group (rfq.create, rfq.manage, suppliers.manage, deliveries.confirm)",
    email: "shady+demo-supply@mdmaktech.sa",
    password: genPassword(),
    name: "خالد الحربي",
    phone: "+966501112224",
    role: "Contractor",
    organizationRole: "member",
  }
  const viewerMember: SeedAccount = {
    label: "Team member — Viewer group (projects.view only)",
    email: "shady+demo-viewer@mdmaktech.sa",
    password: genPassword(),
    name: "فاطمة الزهراني",
    phone: "+966501112225",
    role: "Contractor",
    organizationRole: "member",
  }
  const supplier: SeedAccount = {
    label: "Supplier account",
    email: "shady+demo-supplier@mdmaktech.sa",
    password: genPassword(),
    name: "عبدالله الروابي",
    phone: "+966501112226",
    role: "Supplier",
    organizationRole: "owner",
  }

  console.log("Creating/verifying Firebase Auth accounts...")
  owner.uid = await ensureUser(auth, owner)
  financeMember.uid = await ensureUser(auth, financeMember)
  supplyMember.uid = await ensureUser(auth, supplyMember)
  viewerMember.uid = await ensureUser(auth, viewerMember)
  supplier.uid = await ensureUser(auth, supplier)

  const ownerOrgId = owner.uid!
  const now = FieldValue.serverTimestamp()

  // ---------------------------------------------------------------------
  // 2. users/{uid} docs
  // ---------------------------------------------------------------------
  console.log("\nWriting users/ profile docs...")
  await db.collection("users").doc(owner.uid!).set(
    {
      id: owner.uid,
      name: owner.name,
      email: owner.email,
      phone: owner.phone,
      role: "Contractor",
      organizationId: ownerOrgId,
      organizationRole: "owner",
      companyName: "شركة الرواد المتحدة للمقاولات",
      city: "الرياض",
      specializations: [],
      providers: ["password"],
      isVerified: true,
      profileCompleted: true,
      joinedAt: now,
      lastLoginAt: now,
    },
    { merge: true }
  )

  const memberGroupAssignments: Array<{ acc: SeedAccount; key: SeededGroupKey }> = [
    { acc: financeMember, key: "finance" },
    { acc: supplyMember, key: "supply_chain" },
    { acc: viewerMember, key: "viewer" },
  ]

  for (const { acc, key } of memberGroupAssignments) {
    await db.collection("users").doc(acc.uid!).set(
      {
        id: acc.uid,
        name: acc.name,
        email: acc.email,
        phone: acc.phone,
        role: "Contractor",
        organizationId: ownerOrgId,
        organizationRole: "member",
        defaultGroupId: seededGroupDocId(ownerOrgId, key),
        specializations: [],
        providers: ["password"],
        isVerified: true,
        profileCompleted: true,
        joinedAt: now,
        lastLoginAt: now,
      },
      { merge: true }
    )
  }

  await db.collection("users").doc(supplier.uid!).set(
    {
      id: supplier.uid,
      name: supplier.name,
      email: supplier.email,
      phone: supplier.phone,
      role: "Supplier",
      organizationId: supplier.uid,
      organizationRole: "owner",
      companyName: "مؤسسة الروابي لمواد البناء",
      city: "جدة",
      specializations: ["حديد ومعادن", "أسمنت وخرسانة"],
      providers: ["password"],
      isVerified: true,
      profileCompleted: true,
      joinedAt: now,
      lastLoginAt: now,
    },
    { merge: true }
  )
  console.log("  done.")

  // ---------------------------------------------------------------------
  // 3. teamGroups/ (seeded groups for the owner's org — mirrors team-management.tsx auto-seed)
  // ---------------------------------------------------------------------
  console.log("\nSeeding teamGroups/ for the organization...")
  await Promise.all(
    SEEDED_GROUPS.map((g) =>
      db.collection("teamGroups").doc(seededGroupDocId(ownerOrgId, g.key)).set(
        {
          organizationId: ownerOrgId,
          key: g.key,
          name: g.name,
          permissions: g.permissions,
          isSystem: g.isSystem,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      )
    )
  )
  console.log("  done (super_admin, finance, supply_chain, viewer).")

  // ---------------------------------------------------------------------
  // 4. projects/ — one project owned by the org
  // ---------------------------------------------------------------------
  console.log("\nCreating project...")
  const existingProjectSnap = await db
    .collection("projects")
    .where("organizationId", "==", ownerOrgId)
    .where("name", "==", "مشروع فلل النخيل السكني")
    .limit(1)
    .get()

  let projectId: string
  if (!existingProjectSnap.empty) {
    projectId = existingProjectSnap.docs[0].id
    console.log(`  [exists] project -> ${projectId}`)
  } else {
    const projectRef = await db.collection("projects").add({
      organizationId: ownerOrgId,
      contractorId: owner.uid,
      name: "مشروع فلل النخيل السكني",
      description: "إنشاء 12 فيلا سكنية بنظام التشطيب الفاخر في حي النرجس، الرياض.",
      location: "حي النرجس، الرياض",
      region: "الرياض",
      budget: 4500000,
      status: "active",
      projectType: "proj_type_buildings",
      clientType: "proj_client_private",
      blueprintUrl: null,
      enabledSections: ["contract", "procure", "docs", "receive", "invoice", "cost"],
      rfqIds: [],
      createdAt: now,
      updatedAt: now,
    })
    projectId = projectRef.id
    console.log(`  [created] project -> ${projectId}`)
  }

  // Assign the 3 team members to the project (their group carries over for permission checks)
  console.log("  assigning team members to project...")
  const membersBatch = db.batch()
  for (const { acc, key } of memberGroupAssignments) {
    membersBatch.set(
      db.collection("projects").doc(projectId).collection("members").doc(acc.uid!),
      {
        userId: acc.uid,
        groupId: seededGroupDocId(ownerOrgId, key),
        organizationId: ownerOrgId,
        addedBy: owner.uid,
        createdAt: now,
      },
      { merge: true }
    )
  }
  await membersBatch.commit()
  console.log("  done.")

  // ---------------------------------------------------------------------
  // 5. rfqs/ — created "by" the supply_chain member (has rfq.create/rfq.manage)
  // ---------------------------------------------------------------------
  console.log("\nCreating RFQs...")
  const rfqsToCreate = [
    {
      title: "طلب عروض أسعار - حديد تسليح لمشروع فلل النخيل",
      category: "حديد ومعادن",
      subCategory: "حديد تسليح",
      product: { name: "حديد تسليح", quantity: 500, unitOfMeasure: "طن", description: "حديد تسليح مقاس 12-25مم مطابق للمواصفات السعودية", category: "حديد ومعادن", subCategory: "حديد تسليح", requiresWarranty: false },
      estimatedBudget: 950000,
    },
    {
      title: "طلب عروض أسعار - خرسانة جاهزة لمشروع فلل النخيل",
      category: "أسمنت وخرسانة",
      subCategory: "خرسانة جاهزة",
      product: { name: "خرسانة جاهزة", quantity: 1200, unitOfMeasure: "م³", description: "خرسانة جاهزة مقاومة 30 ميجاباسكال لصب الأساسات والأعمدة", category: "أسمنت وخرسانة", subCategory: "خرسانة جاهزة", requiresWarranty: false },
      estimatedBudget: 480000,
    },
  ]

  const deadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const createdRfqIds: string[] = []

  for (const rfq of rfqsToCreate) {
    const existing = await db
      .collection("rfqs")
      .where("projectId", "==", projectId)
      .where("title", "==", rfq.title)
      .limit(1)
      .get()

    if (!existing.empty) {
      createdRfqIds.push(existing.docs[0].id)
      console.log(`  [exists] ${rfq.title} -> ${existing.docs[0].id}`)
      continue
    }

    const ref = await db.collection("rfqs").add({
      contractorId: owner.uid,
      organizationId: ownerOrgId,
      projectId,
      title: rfq.title,
      category: rfq.category,
      subCategory: rfq.subCategory,
      products: [rfq.product],
      deadline,
      estimatedBudget: rfq.estimatedBudget,
      country: "SA",
      city: "الرياض",
      district: "شمال الرياض",
      notes: "يرجى إرفاق شهادات الجودة ومطابقة المواصفات SASO.",
      pdfUrl: null,
      pdfStoragePath: null,
      status: "New",
      visibility: "public",
      allowedSupplierOrgIds: [],
      orderedFromMdmakDirect: false,
      requiresWarranty: false,
      createdByUserId: supplyMember.uid,
      createdByUserName: supplyMember.name,
      createdAt: new Date().toISOString(),
    })
    await db.collection("projects").doc(projectId).update({ rfqIds: FieldValue.arrayUnion(ref.id) })
    createdRfqIds.push(ref.id)
    console.log(`  [created] ${rfq.title} -> ${ref.id}`)
  }

  // ---------------------------------------------------------------------
  // 6. offers/ — supplier submits one offer on the first RFQ (left pending for live accept/reject)
  // ---------------------------------------------------------------------
  console.log("\nSubmitting supplier offer on the first RFQ...")
  const firstRfqId = createdRfqIds[0]
  const existingOffer = await db
    .collection("offers")
    .where("rfqId", "==", firstRfqId)
    .where("supplierId", "==", supplier.uid)
    .limit(1)
    .get()

  if (!existingOffer.empty) {
    console.log(`  [exists] offer -> ${existingOffer.docs[0].id}`)
  } else {
    const deliveryDate = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const offerRef = await db.collection("offers").add({
      supplierId: supplier.uid,
      organizationId: supplier.uid,
      supplierName: supplier.name,
      companyName: "مؤسسة الروابي لمواد البناء",
      supplierWebsite: null,
      submittedByUserId: supplier.uid,
      submittedByUserName: supplier.name,
      rfqId: firstRfqId,
      rfqTitle: rfqsToCreate[0].title,
      projectId,
      contractorId: owner.uid,
      contractorOrgId: ownerOrgId,
      price: "912000",
      deliveryLocation: "الرياض",
      deliveryBatches: [{ location: "الرياض", deliveryDate, price: "912000" }],
      status: "قيد المراجعة",
      createdAt: new Date().toISOString(),
    })
    console.log(`  [created] offer -> ${offerRef.id} (status: قيد المراجعة — pending contractor review)`)
  }

  // ---------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------
  console.log("\n\n================ DEMO ACCOUNTS ================\n")
  for (const acc of [owner, financeMember, supplyMember, viewerMember, supplier]) {
    console.log(`${acc.label}`)
    console.log(`  Email:    ${acc.email}`)
    console.log(`  Password: ${acc.password}`)
    console.log(`  UID:      ${acc.uid}`)
    console.log("")
  }
  console.log(`Project ID: ${projectId}`)
  console.log(`RFQ IDs:    ${createdRfqIds.join(", ")}`)
  console.log("\n=================================================\n")
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
