// The message a supplier outside the platform receives with the link (LNK-12): written once, here, and shown to the buyer
// BEFORE it goes. It opens on the buyer's own device — WhatsApp or his mail client — with the text ready; the platform sends
// nothing by itself (B-08). Pure.

export type LinkMessageLocale = "ar" | "en"

export interface LinkMessageInput {
  company: string
  title: string
  materials: number
  places: string[]
  /** `YYYY-MM-DD`. */
  closeDay: string | null
  url: string
  locale: LinkMessageLocale
}

export function materialsText(count: number, locale: LinkMessageLocale): string {
  if (locale === "en") return count === 1 ? "1 material" : `${count} materials`
  if (count === 1) return "مادة واحدة"
  if (count === 2) return "مادتان"
  return count >= 3 && count <= 10 ? `${count} مواد` : `${count} مادة`
}

function dayText(day: string | null, locale: LinkMessageLocale): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return ""
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC", calendar: "gregory" })
}

export function buildLinkMessage(i: LinkMessageInput): { text: string; subject: string } {
  const n = materialsText(i.materials, i.locale)
  const where = i.places.filter(Boolean).join(i.locale === "ar" ? "، " : ", ")
  const date = dayText(i.closeDay, i.locale)
  if (i.locale === "en") {
    const lines = [`Hello,`, `${i.company} requests a quote from you via Mdmak:`, `“${i.title}” — ${n}${where ? `, delivery in ${where}` : ""}.`, ...(date ? [`Submissions close ${date}.`] : []), `Quote without an account here:`, i.url]
    return { text: lines.join("\n"), subject: `Quote request — ${i.title}` }
  }
  const lines = [`السلام عليكم،`, `${i.company} تطلب منكم عرض سعر عبر مدماك:`, `«${i.title}» — ${n}${where ? `، والتسليم في ${where}` : ""}.`, ...(date ? [`آخر موعد للتقديم ${date}.`] : []), `قدّم عرضك بلا حساب من الرابط:`, i.url]
  return { text: lines.join("\n"), subject: `طلب عرض سعر — ${i.title}` }
}

/** The addresses the buyer's device opens. No number is typed here: WhatsApp asks him whom to send it to. */
export const whatsappHref = (text: string): string => `https://wa.me/?text=${encodeURIComponent(text)}`

export const mailHref = (subject: string, text: string): string => `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`
