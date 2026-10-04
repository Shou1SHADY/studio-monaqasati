import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { sendEmail } from '@/lib/email';
import { demoRequestBase, escapeHtml } from '@/lib/demo-request';
import { hasCompanyType, normalizeCompanyTypes } from '@/lib/company-types';

const schema = demoRequestBase
  .extend({
    locale: z.enum(['ar', 'en']).optional().default('ar'),
    businessOther: z.string().trim().max(120).optional().default(''),
  })
  .refine((v) => hasCompanyType(v.businessTypes, v.businessOther), { path: ['businessTypes'] });

const TYPE_LABELS_AR = { contractor: 'مقاول', developer: 'مطوّر', supplier: 'مورّد', manufacturer: 'مصنع' } as const;

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: true, message, code }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json().catch(() => null);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return errorResponse('Invalid input', 'INVALID_INPUT', 400);
    }
    const { name, company, phone, email, locale, preferredDate, businessOther } = parsed.data;
    const businessTypes = normalizeCompanyTypes(parsed.data.businessTypes);
    const typeLabel = [...businessTypes.map((t) => TYPE_LABELS_AR[t]), ...(businessOther ? [`أخرى — ${businessOther}`] : [])].join('، ');

    const db = getAdminFirestore();
    await db.collection('demoRequests').add({
      name,
      company,
      phone,
      email,
      preferredDate,
      businessTypes,
      businessOther,
      locale,
      status: 'new',
      createdAt: FieldValue.serverTimestamp(),
    });

    await sendEmail({
      to: 'marco.khouzam@mdmaktech.sa',
      subject: `طلب عرض توضيحي جديد — ${name.replace(/[\r\n]+/g, ' ')} (${company.replace(/[\r\n]+/g, ' ')}) — ${preferredDate}`,
      html: `
        <div dir="rtl" style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0F172A">
          <h2 style="border-bottom:2px solid #20CBD5;padding-bottom:12px;margin-bottom:20px">
            🎯 طلب عرض توضيحي جديد
          </h2>
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="padding:10px 12px;font-weight:600;color:#475569;width:130px;border-bottom:1px solid #e2e8f0">الاسم</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0">${escapeHtml(name)}</td>
            </tr>
            <tr style="background:#f8fafc">
              <td style="padding:10px 12px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0">الشركة</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0">${escapeHtml(company)}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0">نوع النشاط</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0">${escapeHtml(typeLabel)}</td>
            </tr>
            <tr style="background:#f8fafc">
              <td style="padding:10px 12px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0">الموعد المناسب</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0" dir="ltr">${preferredDate}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0">الجوال</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0" dir="ltr">${escapeHtml(phone)}</td>
            </tr>
            <tr style="background:#f8fafc">
              <td style="padding:10px 12px;font-weight:600;color:#475569">البريد الإلكتروني</td>
              <td style="padding:10px 12px" dir="ltr">${escapeHtml(email)}</td>
            </tr>
          </table>
          <p style="margin-top:24px;padding:12px 16px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;color:#166534;font-size:13px">
            تم استلام هذا الطلب من نموذج العرض التوضيحي في موقع مدماك تيك.
          </p>
        </div>
      `,
    });

    return NextResponse.json({ success: true, data: {} });
  } catch (err) {
    console.error('Demo request error:', err);
    return errorResponse('Failed to submit demo request', 'INTERNAL_ERROR', 500);
  }
}
