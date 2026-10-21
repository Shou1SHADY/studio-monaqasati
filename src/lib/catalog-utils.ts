import type { Firestore } from 'firebase/firestore'
import { collection, query, where, getDocs, addDoc, updateDoc, increment, serverTimestamp } from 'firebase/firestore'

export interface CatalogItem {
  id: string
  contractorId: string
  organizationId: string
  name: string
  category: string
  subCategory: string
  /** The material tree's sub-category (PUR-04), when the line was written on the tree. */
  subCategoryId?: string | null
  unit: string
  usageCount: number
  lastQuantity: number
  lastUsedAt: Record<string, unknown> | null
  createdAt: Record<string, unknown> | null
}

interface ValidProduct {
  category: string
  subCategory: string
  otherSubCategory?: string
  subCategoryId?: string | null
  quantity: string
  unit: string
}

export async function upsertCatalogItems(
  db: Firestore,
  contractorId: string,
  organizationId: string,
  products: ValidProduct[]
): Promise<void> {
  const snap = await getDocs(
    query(collection(db, 'contractorCatalog'), where('organizationId', '==', organizationId))
  )
  const existingDocs = snap.docs.map(d => ({ ref: d.ref, data: d.data() }))

  await Promise.all(products.map(async (p) => {
    const subCat = p.subCategory === 'أخرى' ? (p.otherSubCategory || p.category) : p.subCategory
    const name = subCat || p.category

    const existing = existingDocs.find(d =>
      d.data['category'] === p.category &&
      d.data['subCategory'] === subCat &&
      d.data['unit'] === p.unit
    )

    if (existing) {
      await updateDoc(existing.ref, {
        usageCount: increment(1),
        lastQuantity: Number(p.quantity),
        lastUsedAt: serverTimestamp(),
        name,
      })
    } else {
      await addDoc(collection(db, 'contractorCatalog'), {
        contractorId,
        organizationId,
        name,
        category: p.category,
        subCategory: subCat,
        ...(p.subCategoryId ? { subCategoryId: p.subCategoryId } : {}),
        unit: p.unit,
        usageCount: 1,
        lastQuantity: Number(p.quantity),
        lastUsedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      })
    }
  }))
}
