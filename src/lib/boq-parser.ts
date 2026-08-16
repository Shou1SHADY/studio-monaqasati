/**
 * Client-side BOQ (Bill of Quantities) Excel parser.
 * Walks each sheet tracking Category (0-dash code) → Subcategory (1-dash code) state,
 * classifies rows as Measured (priceable) or Text (narrative, excluded), and maps
 * platform categories. Uses dynamic import of xlsx to keep the initial bundle lean.
 */

export type BoqItemType = "measured" | "text"

export interface BoqItem {
  id: string
  itemNo: string
  descriptionEn: string
  descriptionAr: string
  unit: string
  quantity: number
  rate: number
  itemType: BoqItemType
  sheet: string
  divisionNo: string
  divisionNameEn: string
  divisionNameAr: string
  subCategoryCode: string
  subCategoryNameEn: string
  subCategoryNameAr: string
  suggestedCategory: string
  suggestedSubCategory: string
  groupId: string
  selected: boolean
  requiresWarranty: boolean
  /** false when no sheet/description signal matched anything — detectCategory fell through to its generic default. */
  categoryConfident: boolean
  /** true when the row had no parseable quantity and defaulted to 1 (e.g. a lump-sum unit with no number). */
  quantityIsAssumed: boolean
}

export interface BoqProjectInfo {
  projectNo: string
  projectName: string
  revision: string
  totalItems: number
}

export interface BoqParsedGroup {
  id: string
  titleAr: string
  categoryAr: string
}

export interface BoqParseResult {
  projectInfo: BoqProjectInfo
  items: BoqItem[]
  groups: BoqParsedGroup[]
}

// Units that mean "not for separate procurement" — skip these
const SKIP_UNITS = new Set(["n.a", "na", "n/a", "بدون", "", "لا ينطبق"])

// Units that imply a whole-scope price even without an explicit numeric quantity
const LUMP_SUM_UNITS = new Set(["ls", "lot", "lumpsum", "sum"])

/**
 * Detect category from sheet name alone (no item description needed).
 * Used by buildGroups to categorize items when grouping by sheet.
 */
export function detectCategoryFromSheet(
  sheetName: string
): { category: string; subCategory: string; confident: boolean } {
  return detectCategory(sheetName, "")
}

/**
 * Rule-based category + subcategory detection from sheet name and item description.
 * This covers ~95% of standard CSI-based BOQ structures without needing an AI call.
 * This is the platform's own supplier-facing taxonomy (CATEGORIES_DATA) — independent
 * of the file's own Category/Subcategory hierarchy (divisionNo/subCategoryCode below).
 */
function detectCategory(
  sheetName: string,
  descEn: string
): { category: string; subCategory: string; confident: boolean } {
  const s = sheetName.toUpperCase()
  const d = descEn.toLowerCase()

  // DIV 04 — Masonry
  if (s.includes("MASONRY") || s.includes("04")) {
    if (d.includes("insulated")) return { category: "طوب وبلوك", subCategory: "بلوك عازل (إنسوليت)", confident: true }
    if (d.includes("hollow")) return { category: "طوب وبلوك", subCategory: "بلوك أسمنتي مفرغ", confident: true }
    if (d.includes("solid")) return { category: "طوب وبلوك", subCategory: "بلوك أسمنتي مصمت", confident: true }
    return { category: "طوب وبلوك", subCategory: "بلوك أسمنتي مفرغ", confident: true }
  }

  // DIV 05 — Metals
  if (s.includes("METAL") || s.includes("05-")) {
    if (d.includes("aluminum") || d.includes("aluminium") || d.includes("cover")) {
      return { category: "حدادة ومصنوعات معدنية", subCategory: "بوابات حديد", confident: true }
    }
    if (d.includes("stainless") || d.includes("handrail") || d.includes("railing")) {
      return { category: "حدادة ومصنوعات معدنية", subCategory: "درابزين ستانلس ستيل", confident: true }
    }
    return { category: "حديد ومعادن", subCategory: "حديد مشكّل (زوايا، مواسير، صاج)", confident: true }
  }

  // DIV 06 — Wood
  if (s.includes("WOOD") || s.includes("06-")) {
    if (d.includes("mdf")) return { category: "أخشاب", subCategory: "خشب MDF", confident: true }
    if (d.includes("hdf")) return { category: "أخشاب", subCategory: "خشب HDF", confident: true }
    if (d.includes("plywood") || d.includes("ablakash")) return { category: "أخشاب", subCategory: "خشب أبلكاش (بلايود)", confident: true }
    return { category: "أخشاب", subCategory: "خشب MDF", confident: true }
  }

  // DIV 07 — Thermal & Moisture Protection
  if (s.includes("PROTECTION") || s.includes("T&M") || s.includes("07-")) {
    if (d.includes("bitumen") || d.includes("bituminous") || d.includes("membrane")) {
      return { category: "عزل وأسقف", subCategory: "عزل مائي (رولات بيتومين)", confident: true }
    }
    if (d.includes("liquid rubber") || d.includes("waterproof") || d.includes("liquid")) {
      return { category: "عزل وأسقف", subCategory: "عزل مائي سائل", confident: true }
    }
    if (d.includes("polyurethane") || d.includes("foam") || d.includes("pur")) {
      return { category: "عزل وأسقف", subCategory: "عزل حراري (فوم بولي يوريثان)", confident: true }
    }
    if (d.includes("cementitious") || d.includes("epoxy")) {
      return { category: "مواد لاصقة وكيميائية", subCategory: "مانع تسرب بولي يوريثان", confident: true }
    }
    return { category: "عزل وأسقف", subCategory: "عزل مائي سائل", confident: true }
  }

  // DIV 08 — Openings (Doors & Windows)
  if (s.includes("OPENING") || s.includes("08-")) {
    if (d.includes("wooden") || d.includes("wood door")) {
      return { category: "أبواب ونوافذ", subCategory: "أبواب خشبية حشو (HDF)", confident: true }
    }
    if (d.includes("steel door") || d.includes("iron door")) {
      return { category: "أبواب ونوافذ", subCategory: "أبواب حديد", confident: true }
    }
    if (d.includes("curtain wall") || d.includes("glass wall")) {
      return { category: "أبواب ونوافذ", subCategory: "نوافذ زجاج مزدوج", confident: true }
    }
    if (d.includes("aluminum") || d.includes("aluminium") || d.includes("bi-fold")) {
      return { category: "أبواب ونوافذ", subCategory: "أبواب ألمنيوم", confident: true }
    }
    return { category: "أبواب ونوافذ", subCategory: "أبواب ألمنيوم", confident: true }
  }

  // DIV 09 — Finishes (multi-category, detect from description)
  if (s.includes("FINISH") || s.includes("09-")) {
    if (d.includes("plaster") || d.includes("cement plaster")) {
      return { category: "أسمنت وخرسانة", subCategory: "أسمنت تشطيب (لياسة)", confident: true }
    }
    if (d.includes("interior paint") || d.includes("exterior paint") || d.includes("spray paint") || d.includes("painting")) {
      if (d.includes("exterior") || d.includes("external") || d.includes("spray")) {
        return { category: "دهانات وألوان", subCategory: "دهان بلاستيكي خارجي", confident: true }
      }
      return { category: "دهانات وألوان", subCategory: "دهان بلاستيكي (مائي) داخلي", confident: true }
    }
    if (d.includes("stone clad") || d.includes("cladding") || d.includes("stone")) {
      return { category: "أرضيات وتشطيبات", subCategory: "حجر طبيعي", confident: true }
    }
    if (d.includes("gypsum board") || d.includes("gypsum")) {
      if (d.includes("moisture") || d.includes("resistant")) {
        return { category: "جبس وأسقف مستعارة", subCategory: "ألواح جبس بورد مقاوم للرطوبة", confident: true }
      }
      return { category: "جبس وأسقف مستعارة", subCategory: "ألواح جبس بورد عادي", confident: true }
    }
    if (d.includes("porcelain")) return { category: "أرضيات وتشطيبات", subCategory: "بورسلين", confident: true }
    if (d.includes("marble")) return { category: "أرضيات وتشطيبات", subCategory: "رخام طبيعي", confident: true }
    if (d.includes("terrazzo")) return { category: "أرضيات وتشطيبات", subCategory: "بلاط إسمنتي", confident: true }
    if (d.includes("floor") || d.includes("tile")) return { category: "أرضيات وتشطيبات", subCategory: "سيراميك", confident: true }
    return { category: "أرضيات وتشطيبات", subCategory: "بورسلين", confident: false }
  }

  // DIV 10 — Specialities
  if (s.includes("SPECIAL") || s.includes("10-")) {
    return { category: "مواد لاصقة وكيميائية", subCategory: "مواد تقوية خرسانة", confident: false }
  }

  // DIV 14 — Conveying Equipment
  if (s.includes("CONVEYING") || s.includes("14-")) {
    return { category: "معدات وآليات", subCategory: "رافعات (كرينات)", confident: true }
  }

  // DIV 32 — Exterior Improvements
  if (s.includes("EXTERIOR") || s.includes("32-")) {
    if (d.includes("interlock") || d.includes("pav")) {
      return { category: "أرضيات وتشطيبات", subCategory: "بلاط إنترلوك", confident: true }
    }
    return { category: "أرضيات وتشطيبات", subCategory: "بلاط إسمنتي", confident: false }
  }

  // No sheet-name or division signal matched anything — this is a pure guess.
  return { category: "مواد لاصقة وكيميائية", subCategory: "مواد تقوية خرسانة", confident: false }
}

/** Strips a leading "Division:? <digits> -" prefix so only the clean name remains. */
function cleanDivisionLabel(descEn: string): string {
  return descEn.replace(/^division:?\s*\d*\s*[-–]?\s*/i, "").trim() || descEn
}

/** Turns any string into a safe Firestore document-id fragment. */
function sanitizeId(value: string): string {
  return (value || "x").replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "x"
}

interface CodeState {
  code: string
  nameEn: string
  nameAr: string
}

/**
 * Main export: parse a BOQ Excel file and return structured data.
 * Uses dynamic import so the xlsx library only loads on this page.
 */
export async function parseBoqFile(file: File): Promise<BoqParseResult> {
  const xlsxModule = await import("xlsx")
  const XLSX = xlsxModule.default ?? xlsxModule

  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: "array", cellDates: true })

  const projectInfo: BoqProjectInfo = {
    projectNo: "",
    projectName: "",
    revision: "",
    totalItems: 0,
  }

  // Extract project metadata from SUMMARY or first data sheet
  const summarySheet = wb.Sheets["SUMMARY"] ?? wb.Sheets[wb.SheetNames[1]]
  if (summarySheet) {
    const sd = XLSX.utils.sheet_to_json(summarySheet, { header: 1, defval: "" }) as any[][]
    projectInfo.projectNo = String(sd[0]?.[1] ?? "").trim()
    projectInfo.projectName = String(sd[1]?.[1] ?? "").trim()
    projectInfo.revision = String(sd[3]?.[1] ?? "R00").trim()
  }

  const items: BoqItem[] = []
  const groupsById = new Map<string, BoqParsedGroup>()

  for (const sheetName of wb.SheetNames) {
    if (["COVER", "SUMMARY"].includes(sheetName.toUpperCase())) continue

    const ws = wb.Sheets[sheetName]
    if (!ws) continue

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][]

    let currentCategory: CodeState = { code: "", nameEn: "", nameAr: "" }
    let currentSubCategory: CodeState = { code: "", nameEn: "", nameAr: "" }

    for (let i = 6; i < rows.length; i++) {
      const row = rows[i]
      const itemNo = String(row[0] ?? "").trim()
      if (!itemNo) continue // blank separator / "TO COLLECTION" subtotal rows

      const descEn = String(row[1] ?? "").trim()
      const unit = String(row[2] ?? "").trim()
      const qtyNum = Number(row[3])
      const rateNum = Number(row[4]) || 0
      const descAr = String(row[6] ?? "").trim()
      const dashCount = (itemNo.match(/[-–]/g) || []).length

      const unitNorm = unit.toLowerCase().replace(/\s/g, "")
      const hasValidUnit = unitNorm !== "" && !SKIP_UNITS.has(unitNorm)
      const hasQty = !isNaN(qtyNum) && qtyNum > 0
      const isLumpSum = LUMP_SUM_UNITS.has(unitNorm)
      const isMeasured = hasValidUnit && (hasQty || isLumpSum) && descEn.length >= 5

      if (dashCount === 0) {
        currentCategory = { code: itemNo, nameEn: cleanDivisionLabel(descEn), nameAr: descAr }
        currentSubCategory = { code: "", nameEn: "", nameAr: "" }
        continue
      }

      if (isMeasured) {
        const subCode = currentSubCategory.code || currentCategory.code
        const subNameEn = currentSubCategory.code ? currentSubCategory.nameEn : currentCategory.nameEn
        const subNameAr = currentSubCategory.code ? currentSubCategory.nameAr : currentCategory.nameAr
        const { category, subCategory, confident } = detectCategory(sheetName, descEn)
        const groupId = `grp_${sanitizeId(sheetName)}_${sanitizeId(subCode)}`

        items.push({
          id: `${sheetName.replace(/\s/g, "_")}_${i}`,
          itemNo,
          descriptionEn: descEn,
          descriptionAr: descAr,
          unit,
          quantity: hasQty ? qtyNum : 1,
          rate: rateNum,
          itemType: "measured",
          sheet: sheetName,
          divisionNo: currentCategory.code,
          divisionNameEn: currentCategory.nameEn,
          divisionNameAr: currentCategory.nameAr,
          subCategoryCode: subCode,
          subCategoryNameEn: subNameEn,
          subCategoryNameAr: subNameAr,
          suggestedCategory: category,
          suggestedSubCategory: subCategory,
          groupId,
          selected: true,
          requiresWarranty: false,
          categoryConfident: confident,
          quantityIsAssumed: !hasQty,
        })

        if (!groupsById.has(groupId)) {
          groupsById.set(groupId, {
            id: groupId,
            titleAr: subNameAr || subNameEn || currentCategory.nameAr || currentCategory.nameEn,
            categoryAr: category,
          })
        }
        continue
      }

      if (dashCount === 1) {
        currentSubCategory = { code: itemNo, nameEn: descEn, nameAr: descAr }
        continue
      }

      // dashCount >= 2 and not measured → narrative/contractual Text item, excluded from items[]
    }
  }

  projectInfo.totalItems = items.length
  return { projectInfo, items, groups: Array.from(groupsById.values()) }
}
