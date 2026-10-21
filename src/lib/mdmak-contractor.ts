import { collection, addDoc } from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import { MDMAK_SUPPLIER_ID } from './mdmak-procurement'
import { rfqMaterialFields } from './materials/reach'
import type { MaterialPick } from './materials/types'

// Mdmak Tech acts as a single system identity on both sides of the marketplace —
// as a supplier (mdmak-procurement.ts) and, here, as a contractor posting its own
// RFQs for real suppliers to bid on.
export const MDMAK_CONTRACTOR_ID = MDMAK_SUPPLIER_ID

export interface MdmakRfqProduct {
  name: string
  quantity: number
  unitOfMeasure: string
  description: string
  category: string
  subCategory: string
  /** The material as picked from the tree (PUR-04): suppliers are reached by its sub-category. */
  material?: MaterialPick | null
  materialPath?: string
}

export async function createMdmakRfq(
  db: Firestore,
  adminUid: string,
  params: {
    title: string
    products: MdmakRfqProduct[]
    city: string
    district: string
    deadline: string
    estimatedBudget: number | null
    notes: string
    pdfUrl: string | null
    pdfStoragePath: string | null
  }
): Promise<{ rfqId: string }> {
  const fields = rfqMaterialFields(params.products.map(p => ({ material: p.material ?? null, category: p.category, subCategory: p.subCategory })))

  const ref = await addDoc(collection(db, 'rfqs'), {
    contractorId: MDMAK_CONTRACTOR_ID,
    organizationId: MDMAK_CONTRACTOR_ID,
    projectId: null,
    title: params.title,
    ...fields,
    materialTree: params.products.some(p => p.material),
    products: params.products,
    deadline: params.deadline,
    estimatedBudget: params.estimatedBudget,
    city: params.city,
    district: params.district,
    notes: params.notes,
    pdfUrl: params.pdfUrl,
    pdfStoragePath: params.pdfStoragePath,
    status: 'New',
    visibility: 'public',
    allowedSupplierOrgIds: [],
    createdByUserId: adminUid,
    createdByUserName: 'مدماك تيك',
    isFromMdmak: true,
    createdAt: new Date().toISOString(),
  })

  return { rfqId: ref.id }
}
