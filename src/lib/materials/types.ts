// The material tree (Procurement 1.5, PUR-04): Watad's tree adopted as it is — three
// levels (20 categories, 106 sub-categories, 168 third-level), 250 materials to pick,
// 687 specifications with their options, 41 brands, units per material, in Arabic and
// English. ONE list for the RFQ editor, the team's material request, Project
// Management's material request, the inventory catalogue and the suppliers'
// specialties.
// Lives in Firestore `categories/{rootId}` (one document per category — the
// collection the rules already gave to reference data: any signed-in user reads,
// only the admin writes), managed from Admin → Materials; `public/data/material-tree.json`
// is the seed and the fallback while the collection is empty.

export const MATERIAL_TREE = "categories"
/** Materials typed outside the list («غير موجود؟ اكتبه كما هو»): one document in the same collection, written
 * by the server (/api/materials/suggest), read by the platform team in Admin → Materials. It carries no company. */
export const MATERIAL_SUGGESTIONS_DOC = "__suggestions"

export interface MaterialSuggestion {
  name: string
  subId: string
  /** The sub-category's words when it was suggested. */
  sub: string
  count: number
  firstAt: string
  lastAt: string
}

export interface MaterialText {
  ar: string
  en: string
}

export interface MaterialUnit extends MaterialText {
  /** Watad's unit key: pc, m3, m2, m, ton, trip, drum, roll, l, kg, bag. */
  key: string
}

/** What a bar or a roll of the material is sold as («قطعة 6 م», «لفة 25 م»): priced per piece, compared in the unit asked for. */
export interface MaterialSaleUnit extends MaterialText {
  lengthM: number
  /** Named in the sale-unit list, or read from the «الطول» spec's options. */
  from: "list" | "spec"
}

export interface MaterialSpec extends MaterialText {
  mandatory: boolean
  options: MaterialText[]
}

export interface MaterialNode extends MaterialText {
  id: string
  level: 1 | 2 | 3
  units: MaterialUnit[]
  specs: MaterialSpec[]
  brands: MaterialText[]
  keywords: string[]
  installation: boolean
  saleUnits?: MaterialSaleUnit[]
  /** Taken off the pickers by the platform team; existing documents keep reading it. */
  hidden?: boolean
  children: MaterialNode[]
}

/** One Firestore document per first-level category. */
export interface MaterialRootDoc {
  root: MaterialNode
  order: number
  updatedAt?: string
  updatedBy?: string | null
}

export interface MaterialTreeFile {
  source: string
  fetched: string
  package?: string
  roots: MaterialNode[]
}

/**
 * A material as a line carries it: the node picked, its path, the sub-category
 * suppliers are matched on (by id, never by name), and the specification values
 * chosen. Free text («خارج القائمة») still names its sub-category.
 */
export interface MaterialPick {
  /** The picked node (a leaf, or a sub-category when typed as free text). */
  nodeId: string
  /** Level-2 id the line is matched on; a first-level leaf («مزروعات») is its own. */
  subId: string
  rootId: string
  /** The path as words at the time of the pick, for readers that do not load the tree. */
  path: MaterialText[]
  /** Chosen spec values by spec name (Arabic), plus free ones. */
  specs: Array<{ name: MaterialText; value: MaterialText; free?: boolean }>
  brand?: MaterialText | null
  /** The lengths the material is sold in at the time of the pick, when it has any (priced per piece, compared in the unit asked for). */
  saleUnits?: MaterialSaleUnit[]
  /** Typed by the user — not in the list. */
  outside?: boolean
}
