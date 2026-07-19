import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  type Firestore,
  type FieldValue,
} from 'firebase/firestore'

export interface MdmakProcurement {
  id: string
  rfqId: string
  rfqTitle?: string
  contractorId?: string
  organizationId?: string
  internalCost: number
  commissionRate: number
  commissionAmount: number
  finalPrice: number
  linkedOfferId?: string
  status: 'pending' | 'offer_sent' | 'accepted' | 'rejected' | 'in_progress' | 'delivered'
  adminNotes?: string
  createdBy: string
  createdAt: FieldValue | string | null
  updatedAt: FieldValue | string | null
}

export interface PlatformSettings {
  defaultCommissionRate: number
  updatedBy?: string
  updatedAt?: FieldValue | string | null
}

export const MDMAK_SUPPLIER_ID = 'mdmak-system'
export const PLATFORM_SETTINGS_DOC = 'mdmak_procurement'

export function calcCommission(internalCost: number, rate: number) {
  const commissionAmount = Math.round(internalCost * (rate / 100) * 100) / 100
  const finalPrice = Math.round((internalCost + commissionAmount) * 100) / 100
  return { commissionAmount, finalPrice }
}

export async function getCommissionRate(db: Firestore): Promise<number> {
  const snap = await getDoc(doc(db, 'platformSettings', PLATFORM_SETTINGS_DOC))
  if (snap.exists()) return (snap.data() as PlatformSettings).defaultCommissionRate ?? 10
  return 10
}

export async function saveCommissionRate(
  db: Firestore,
  rate: number,
  adminUid: string
): Promise<void> {
  await updateDoc(doc(db, 'platformSettings', PLATFORM_SETTINGS_DOC), {
    defaultCommissionRate: rate,
    updatedBy: adminUid,
    updatedAt: serverTimestamp(),
  })
}

export async function createMdmakOffer(
  db: Firestore,
  adminUid: string,
  params: {
    rfqId: string
    rfqTitle: string
    contractorId: string
    contractorOrgId: string
    internalCost: number
    commissionRate: number
    adminNotes?: string
  }
): Promise<{ procurementId: string; offerId: string }> {
  const { commissionAmount, finalPrice } = calcCommission(params.internalCost, params.commissionRate)

  const offerRef = await addDoc(collection(db, 'offers'), {
    rfqId: params.rfqId,
    rfqTitle: params.rfqTitle,
    supplierId: MDMAK_SUPPLIER_ID,
    supplierName: 'مدماك تيك',
    supplierOrgId: MDMAK_SUPPLIER_ID,
    contractorId: params.contractorId,
    contractorOrgId: params.contractorOrgId,
    organizationId: params.contractorOrgId,
    price: finalPrice,
    currency: 'SAR',
    status: 'قيد المراجعة',
    isFromMdmak: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const procRef = await addDoc(collection(db, 'mdmakProcurement'), {
    rfqId: params.rfqId,
    rfqTitle: params.rfqTitle,
    contractorId: params.contractorId,
    organizationId: params.contractorOrgId,
    internalCost: params.internalCost,
    commissionRate: params.commissionRate,
    commissionAmount,
    finalPrice,
    linkedOfferId: offerRef.id,
    status: 'offer_sent',
    adminNotes: params.adminNotes ?? '',
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return { procurementId: procRef.id, offerId: offerRef.id }
}

export async function getMdmakProcurementForRfq(
  db: Firestore,
  rfqId: string
): Promise<MdmakProcurement | null> {
  const q = query(collection(db, 'mdmakProcurement'), where('rfqId', '==', rfqId))
  const snaps = await getDocs(q)
  if (snaps.empty) return null
  const d = snaps.docs[0]
  return { id: d.id, ...d.data() } as MdmakProcurement
}
