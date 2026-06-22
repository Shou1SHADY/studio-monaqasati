/** Mandatory contractor profile fields that must be filled before an RFQ can be published. */
const REQUIRED_FIELDS: Array<{ key: string; labelAr: string; labelEn: string }> = [
  { key: "name",     labelAr: "الاسم",              labelEn: "Name" },
  { key: "phone",    labelAr: "رقم الهاتف",          labelEn: "Phone" },
  { key: "crNumber", labelAr: "رقم السجل التجاري",   labelEn: "CR Number" },
  { key: "city",     labelAr: "المدينة",             labelEn: "City" },
]

type Profile = Record<string, unknown> | null | undefined

/**
 * Returns the display labels of profile fields that are missing or blank.
 * Empty array means the profile is publish-ready.
 */
export function getIncompletePublishFields(profile: Profile, locale: string): string[] {
  if (!profile) return REQUIRED_FIELDS.map(f => locale === "ar" ? f.labelAr : f.labelEn)
  return REQUIRED_FIELDS.filter(f => !String(profile[f.key] ?? "").trim())
    .map(f => locale === "ar" ? f.labelAr : f.labelEn)
}

/** Returns true when all required publish fields are filled. */
export function isPublishReady(profile: Profile): boolean {
  if (!profile) return false
  return REQUIRED_FIELDS.every(f => String(profile[f.key] ?? "").trim().length > 0)
}
