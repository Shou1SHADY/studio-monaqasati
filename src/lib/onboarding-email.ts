import { escapeHtml } from "@/lib/demo-request"

export type OnboardingEmailFields = {
  name: string
  company: string
  phone: string
  email: string
  typeLabel: string
  city: string
  size: string
}

const LABEL = "padding:10px 12px;font-weight:600;color:#475569"
const CELL = "padding:10px 12px"
const RULE = "border-bottom:1px solid #e2e8f0"

function row(label: string, value: string, opts: { shaded?: boolean; last?: boolean; ltr?: boolean } = {}): string {
  const rule = opts.last ? "" : `;${RULE}`
  const dir = opts.ltr ? ' dir="ltr"' : ""
  const style = opts.shaded ? ' style="background:#f8fafc"' : ""
  return `<tr${style}><td style="${LABEL}${rule}">${label}</td><td style="${CELL}${rule}"${dir}>${escapeHtml(value)}</td></tr>`
}

export function onboardingEmailHtml(f: OnboardingEmailFields): string {
  return `
      <div dir="rtl" style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0F172A">
        <h2 style="border-bottom:2px solid #20CBD5;padding-bottom:12px;margin-bottom:20px">
          طلب انضمام جديد
        </h2>
        <table style="width:100%;border-collapse:collapse">
          ${row("الاسم", f.name)}
          ${row("الشركة", f.company, { shaded: true })}
          ${row("الجوال", f.phone, { ltr: true })}
          ${row("البريد الإلكتروني", f.email, { shaded: true, ltr: true })}
          ${row("نوع النشاط", f.typeLabel)}
          ${row("المدينة", f.city, { shaded: true })}
          ${row("حجم الشركة", f.size, { last: true })}
        </table>
      </div>
    `
}
