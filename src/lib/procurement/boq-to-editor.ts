// A project's BOQ lines on their way to the RFQ editor (PUR-02/03). The selected lines become the rows
// of ONE draft, in the project's group: a line the tree recognises arrives with its material and
// sub-category, one it does not arrives uncategorised («اختر المادة») for the editor to colour. The
// draft is never published from here — the buyer reviews it in the editor and publishes it there.

import { groupsMeta, linesFromNames, newGroup, numberedLines, rfqLinesDoc } from "./rfq-editor"
import { projectSiteId } from "./delivery-sites"
import type { MaterialIndex } from "@/lib/materials/tree"

export interface BoqDraftItem {
  id: string
  itemNo?: string | null
  descriptionAr?: string | null
  descriptionEn?: string | null
  unit?: string | null
  /** The line's whole quantity — the BOQ stays the reference. */
  quantity: number | string
  /** What this request draws from it. */
  draw: number
  requiresWarranty?: boolean | null
}

export interface BoqDraftInput {
  items: BoqDraftItem[]
  index: MaterialIndex | null
  projectId: string
  projectName: string
  title: string
  city: string
  district: string
  deadline: string
  shipmentMode: "single" | "multiple"
  locale: string
  identity: { contractorId: string; organizationId: string; createdByUserId: string; createdByUserName: string; createdAt: string }
}

export function boqDraftDoc(input: BoqDraftInput): Record<string, unknown> {
  const lines = linesFromNames(
    input.items.map((i) => ({ name: (i.descriptionAr || i.descriptionEn || "").trim(), quantity: String(i.draw), unit: (i.unit || "").trim() })),
    input.index,
  ).map((l, k) => ({ ...l, requiresWarranty: !!input.items[k].requiresWarranty }))
  const group = newGroup({ siteId: projectSiteId(input.projectId), projectId: input.projectId, label: input.projectName, city: input.city, district: input.district || input.city, lines })
  const groups = [group]
  const doc = rfqLinesDoc(groups, input.locale, () => input.projectName, { draft: true })
  const byKey = new Map(lines.map((l, k) => [l.key, input.items[k]]))
  const rows = numberedLines(groups)
  const products = doc.products.map((p, i) => {
    const item = byKey.get(rows[i].line.key) as BoqDraftItem
    const english = (item.descriptionEn || "").trim()
    return {
      ...p,
      ...(english && english !== p.name ? { nameEn: english } : {}),
      description: [p.description, english && english !== p.name ? english : ""].filter(Boolean).join(" · "),
      boqItemNo: item.itemNo ?? null,
      boqItemId: item.id,
      boqTotalQuantity: Number(item.quantity) || 0,
    }
  })
  return {
    ...input.identity,
    projectId: input.projectId,
    projectIds: [input.projectId],
    title: input.title,
    ...doc,
    products,
    editorGroups: groupsMeta(groups),
    materialTree: true,
    quantity: String(input.items.reduce((sum, i) => sum + i.draw, 0)),
    notes: "",
    attachments: [],
    pdfUrl: null,
    pdfStoragePath: null,
    deadline: input.deadline,
    city: input.city,
    district: input.district || input.city,
    multiPlace: false,
    cities: [input.city],
    country: "SA",
    isInternational: false,
    shipmentMode: input.shipmentMode,
    estimatedBudget: null,
    status: "Draft",
    pricingMode: "line",
    visibility: "public",
    allowedSupplierOrgIds: [],
    requiresWarranty: input.items.some((i) => i.requiresWarranty),
    boqProjectName: input.projectName,
    updatedAt: input.identity.createdAt,
  }
}
