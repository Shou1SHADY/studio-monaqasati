import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminFirestore } from '@/lib/firebaseAdmin'
import { sendEmail } from '@/lib/email'

const schema = z.object({
  name: z.string().trim().min(2).max(200),
  company: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().toLowerCase().email(),
  cr: z.string().regex(/^\d{10}$/, 'CR must be 10 digits'),
  vat: z.string().regex(/^\d{15}$/, 'VAT must be 15 digits'),
  city: z.string().trim().min(1).max(100),
  size: z.string().trim().min(1).max(100),
  locale: z.enum(['ar', 'en']).optional().default('ar'),
})

export async function POST(req: NextRequest) {
  try {
    const json = await req.json().catch(() => null)
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: true, message: 'Invalid input', code: 'INVALID_INPUT' }, { status: 400 })
    }

    const { name, company, phone, email, cr, vat, city, size, locale } = parsed.data

    const emailHtml = `
      <div dir="rtl" style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0F172A">
        <h2 style="border-bottom:2px solid #20CBD5;padding-bottom:12px;margin-bottom:20px">
          طلب انضمام جديد من المقاول
        </h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:10px 12px;font-weight:600;color:#475569;width:160px;border-bottom:1px solid #e2e8f0">الاسم</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0">${name}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:10px 12px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0">الشركة</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0">${company}</td></tr>
          <tr><td style="padding:10px 12px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0">الجوال</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0" dir="ltr">${phone}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:10px 12px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0">البريد الإلكتروني</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0" dir="ltr">${email}</td></tr>
          <tr><td style="padding:10px 12px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0">السجل التجاري</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0" dir="ltr">${cr}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:10px 12px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0">الرقم الضريبي</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0" dir="ltr">${vat}</td></tr>
          <tr><td style="padding:10px 12px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0">المدينة</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0">${city}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:10px 12px;font-weight:600;color:#475569">حجم الشركة</td><td style="padding:10px 12px">${size}</td></tr>
        </table>
      </div>
    `

    // Firestore is non-fatal — if Admin SDK credentials are missing or wrong, log and continue.
    let savedToDb = false
    try {
      const db = getAdminFirestore()
      await db.collection('onboardingRequests').add({
        name, company, phone, email, cr, vat, city, size, locale,
        status: 'new',
        createdAt: FieldValue.serverTimestamp(),
      })
      savedToDb = true
    } catch (dbErr) {
      console.error('[onboarding] Firestore write failed:', dbErr)
    }

    const emailResult = await sendEmail({
      to: 'marco.khouzam@mdmaktech.sa',
      subject: `طلب انضمام جديد — ${name} (${company})`,
      html: emailHtml,
    })

    if (!savedToDb && !emailResult.sent) {
      console.error('[onboarding] Both Firestore and email failed. Data:', { name, company, phone, email, cr, vat, city, size, locale })
      return NextResponse.json({ error: true, message: 'Failed to submit request', code: 'INTERNAL_ERROR' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: {} })
  } catch (err) {
    console.error('Onboarding request error:', err)
    return NextResponse.json({ error: true, message: 'Failed to submit request', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
