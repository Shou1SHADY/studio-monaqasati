import { z } from "zod"

export const COMPANY_TYPES = ["contractor", "developer", "supplier", "manufacturer"] as const
export type CompanyType = (typeof COMPANY_TYPES)[number]

export const companyTypesSchema = z.array(z.enum(COMPANY_TYPES)).max(COMPANY_TYPES.length)

export function normalizeCompanyTypes(types: readonly string[]): CompanyType[] {
  return COMPANY_TYPES.filter((t) => types.includes(t))
}

export function isAllCompanyTypes(types: readonly string[]): boolean {
  return COMPANY_TYPES.every((t) => types.includes(t))
}

export function hasCompanyType(types: readonly string[], other: string): boolean {
  return types.length > 0 || other.trim().length >= 2
}

export function toggleCompanyType(types: readonly CompanyType[], type: CompanyType): CompanyType[] {
  return normalizeCompanyTypes(types.includes(type) ? types.filter((t) => t !== type) : [...types, type])
}

export function toggleAllCompanyTypes(types: readonly CompanyType[]): CompanyType[] {
  return isAllCompanyTypes(types) ? [] : [...COMPANY_TYPES]
}

export type LeadTypeFields = {
  businessTypes?: unknown
  companyTypes?: unknown
  businessType?: unknown
  businessOther?: unknown
  companyTypeOther?: unknown
}

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

export function leadCompanyTypes(doc: LeadTypeFields): { types: CompanyType[]; other: string } {
  const stored = asStrings(doc.businessTypes).concat(asStrings(doc.companyTypes))
  const legacy = doc.businessType === "manufacturer" ? ["manufacturer"] : []
  const other = [doc.businessOther, doc.companyTypeOther].find((v): v is string => typeof v === "string" && v.trim() !== "") ?? ""
  return { types: normalizeCompanyTypes([...stored, ...legacy]), other: other.trim() }
}
