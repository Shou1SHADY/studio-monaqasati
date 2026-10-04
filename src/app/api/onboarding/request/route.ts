import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminFirestore } from '@/lib/firebaseAdmin'
import { sendEmail } from '@/lib/email'
import { companyTypesSchema, hasCompanyType, normalizeCompanyTypes } from '@/lib/company-types'
import { onboardingEmailHtml } from '@/lib/onboarding-email'

const schema = z.object({
  name: z.string().trim().min(2).max(200),
  company: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().toLowerCase().email(),
  city: z.string().trim().min(1).max(100),
  size: z.string().trim().min(1).max(100),
  companyTypes: companyTypesSchema,
  companyTypeOther: z.string().trim().max(120).optional().default(''),
  locale: z.enum(['ar', 'en']).optional().default('ar'),
}).refine((v) => hasCompanyType(v.companyTypes, v.companyTypeOther), { path: ['companyTypes'] })

const TYPE_LABELS_AR = { contractor: 'مقاول', developer: 'مطوّر', supplier: 'مورّد', manufacturer: 'مصنع' } as const

export async function POST(req: NextRequest) {
  try {
    const json = await req.json().catch(() => null)
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: true, message: 'Invalid input', code: 'INVALID_INPUT' }, { status: 400 })
    }

    const { name, company, phone, email, city, size, locale, companyTypeOther } = parsed.data
    const companyTypes = normalizeCompanyTypes(parsed.data.companyTypes)
    const typeLabel = [...companyTypes.map((t) => TYPE_LABELS_AR[t]), ...(companyTypeOther ? [`أخرى — ${companyTypeOther}`] : [])].join('، ')

    const emailHtml = onboardingEmailHtml({ name, company, phone, email, typeLabel, city, size })

    // Firestore is non-fatal — if Admin SDK credentials are missing or wrong, log and continue.
    let savedToDb = false
    try {
      const db = getAdminFirestore()
      await db.collection('onboardingRequests').add({
        name, company, phone, email, city, size, locale, companyTypes, companyTypeOther,
        status: 'new',
        createdAt: FieldValue.serverTimestamp(),
      })
      savedToDb = true
    } catch (dbErr) {
      console.error('[onboarding] Firestore write failed:', dbErr)
    }

    const emailResult = await sendEmail({
      to: 'marco.khouzam@mdmaktech.sa',
      subject: `طلب انضمام جديد — ${name.replace(/[\r\n]+/g, ' ')} (${company.replace(/[\r\n]+/g, ' ')})`,
      html: emailHtml,
    })

    if (!savedToDb && !emailResult.sent) {
      console.error('[onboarding] Both Firestore and email failed. Data:', { name, company, phone, email, city, size, locale })
      return NextResponse.json({ error: true, message: 'Failed to submit request', code: 'INTERNAL_ERROR' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: {} })
  } catch (err) {
    console.error('Onboarding request error:', err)
    return NextResponse.json({ error: true, message: 'Failed to submit request', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
