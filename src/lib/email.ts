// Server-only — transactional email via the Resend REST API.
// Never import this file in client components.

type SendEmailInput = {
  to: string
  subject: string
  html: string
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn("RESEND_API_KEY not configured — email skipped.")
    return { sent: false, error: "EMAIL_NOT_CONFIGURED" }
  }

  // Default sender uses a subdomain per Resend's deliverability guidance:
  // reputation isolation from the root domain + clearer inbox triage.
  const from = process.env.EMAIL_FROM || "Mdmak Tech <noreply@notifications.mdmaktech.sa>"

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error("Resend API error:", res.status, body)
      return { sent: false, error: `RESEND_${res.status}` }
    }

    return { sent: true }
  } catch (err) {
    console.error("Failed to reach Resend:", err)
    return { sent: false, error: "EMAIL_NETWORK_ERROR" }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// Shared branded shell so all transactional emails look identical.
function buildEmailShell(inner: {
  greetingAr: string
  greetingEn: string
  bodyAr: string
  bodyEn: string
  ctaAr: string
  ctaEn: string
  inviteUrl: string
}): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(15,23,42,0.08);">
          <tr>
            <td style="background-color:#0F172A;padding:28px 32px;text-align:center;">
              <span style="color:#ffffff;font-size:22px;font-weight:700;">مدماك تيك</span>
              <span style="color:#20CBD5;font-size:22px;font-weight:700;"> | Mdmak Tech</span>
            </td>
          </tr>
          <tr>
            <td dir="rtl" style="padding:32px 32px 8px;text-align:right;">
              <p style="margin:0 0 12px;color:#0F172A;font-size:17px;font-weight:700;line-height:1.7;">${inner.greetingAr}</p>
              <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.9;">${inner.bodyAr}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 8px;text-align:center;">
              <a href="${inner.inviteUrl}"
                 style="display:inline-block;background-color:#0369A1;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:10px;">
                ${inner.ctaAr}<br /><span style="font-size:13px;font-weight:500;">${inner.ctaEn}</span>
              </a>
            </td>
          </tr>
          <tr>
            <td dir="ltr" style="padding:16px 32px 8px;text-align:left;border-top:1px solid #e2e8f0;">
              <p style="margin:16px 0 12px;color:#0F172A;font-size:16px;font-weight:700;line-height:1.5;">${inner.greetingEn}</p>
              <p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.7;">${inner.bodyEn}</p>
            </td>
          </tr>
          <tr>
            <td dir="ltr" style="padding:0 32px 24px;text-align:left;">
              <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">
                If the button doesn't work, copy this link into your browser:<br />
                <a href="${inner.inviteUrl}" style="color:#0369A1;word-break:break-all;">${inner.inviteUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.8;">
                منصة مدماك تيك للمشتريات الذكية — Mdmak Tech Smart Procurement<br />
                <a href="https://mdmaktech.sa" style="color:#0369A1;text-decoration:none;">mdmaktech.sa</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

type TeamInviteEmailInput = {
  inviterName: string
  orgName: string
  memberName?: string | null
  groupName?: string | null
  inviteUrl: string
  isExistingUser: boolean
}

export function buildTeamInviteEmail({
  inviterName,
  orgName,
  memberName,
  groupName,
  inviteUrl,
  isExistingUser,
}: TeamInviteEmailInput): { subject: string; html: string } {
  const safeInviter = escapeHtml(inviterName || "")
  const safeOrg = escapeHtml(orgName || "مؤسستنا")
  const safeOrgEn = escapeHtml(orgName || "their organization")
  const safeGroup = groupName ? escapeHtml(groupName) : null

  const greetingAr = memberName ? `مرحباً ${escapeHtml(memberName)},` : "مرحباً,"
  const greetingEn = memberName ? `Hello ${escapeHtml(memberName)},` : "Hello,"

  const groupNoteAr = safeGroup ? ` ضمن مجموعة «${safeGroup}»` : ""
  const groupNoteEn = safeGroup ? ` in the "${safeGroup}" group` : ""

  const bodyAr = isExistingUser
    ? `دعاك ${safeInviter ? `<strong>${safeInviter}</strong>` : "أحد الزملاء"} للانضمام إلى فريق <strong>${safeOrg}</strong>${groupNoteAr} على منصة مدماك تيك. سجّل الدخول إلى حسابك ثم افتح صفحة «الفريق» لقبول الدعوة.`
    : `دعاك ${safeInviter ? `<strong>${safeInviter}</strong>` : "أحد الزملاء"} للانضمام إلى فريق <strong>${safeOrg}</strong>${groupNoteAr} على منصة مدماك تيك — منصة المشتريات وطلبات عروض الأسعار للمقاولين والموردين في السعودية. أنشئ حسابك عبر الرابط أدناه وستنضم إلى فريق المؤسسة تلقائياً.`

  const bodyEn = isExistingUser
    ? `${safeInviter ? `<strong>${safeInviter}</strong>` : "A colleague"} invited you to join the <strong>${safeOrgEn}</strong> team${groupNoteEn} on Mdmak Tech. Log in to your account and open the Team page to accept the invitation.`
    : `${safeInviter ? `<strong>${safeInviter}</strong>` : "A colleague"} invited you to join the <strong>${safeOrgEn}</strong> team${groupNoteEn} on Mdmak Tech — the B2B procurement & RFQ platform for contractors and suppliers in Saudi Arabia. Create your account using the link below and you will join the organization's team automatically.`

  const ctaAr = isExistingUser ? "تسجيل الدخول وقبول الدعوة" : "إنشاء حساب والانضمام للفريق"
  const ctaEn = isExistingUser ? "Log in & accept invitation" : "Register & join the team"

  const subject = `دعوة للانضمام إلى فريق ${orgName || "مدماك تيك"} — Team invitation on Mdmak Tech`
  const html = buildEmailShell({ greetingAr, greetingEn, bodyAr, bodyEn, ctaAr, ctaEn, inviteUrl })
  return { subject, html }
}

type SupplierInviteEmailInput = {
  contractorName: string
  companyName?: string | null
  inviteUrl: string
  isExistingUser: boolean
}

export function buildSupplierInviteEmail({
  contractorName,
  companyName,
  inviteUrl,
  isExistingUser,
}: SupplierInviteEmailInput): { subject: string; html: string } {
  const safeContractor = escapeHtml(contractorName || "أحد المقاولين على المنصة")
  const safeContractorEn = escapeHtml(contractorName || "A contractor on our platform")
  const greetingAr = companyName ? `مرحباً ${escapeHtml(companyName)},` : "مرحباً,"
  const greetingEn = companyName ? `Hello ${escapeHtml(companyName)},` : "Hello,"

  const ctaAr = isExistingUser ? "تسجيل الدخول وقبول الدعوة" : "إنشاء حساب وقبول الدعوة"
  const ctaEn = isExistingUser ? "Log in & accept invitation" : "Register & accept invitation"

  const bodyAr = isExistingUser
    ? `دعاك <strong>${safeContractor}</strong> للانضمام إلى دليل مورّديه على منصة مدماك تيك. سجّل الدخول إلى حسابك ثم افتح صفحة «جهات الاتصال» لقبول الدعوة.`
    : `دعاك <strong>${safeContractor}</strong> للانضمام كمورّد على منصة مدماك تيك — منصة المشتريات وطلبات عروض الأسعار للمقاولين والموردين في السعودية. أنشئ حسابك عبر الرابط أدناه وسيتم ربطك بدليل مورّدي المقاول تلقائياً.`

  const bodyEn = isExistingUser
    ? `<strong>${safeContractorEn}</strong> invited you to join their supplier directory on Mdmak Tech. Log in to your account and open the Connections page to accept the invitation.`
    : `<strong>${safeContractorEn}</strong> invited you to join Mdmak Tech as a supplier — the B2B procurement & RFQ platform connecting contractors and suppliers in Saudi Arabia. Create your account using the link below and you will be linked to the contractor's supplier directory automatically.`

  const subject = `دعوة للانضمام كمورّد من ${contractorName || "مدماك تيك"} — Supplier invitation on Mdmak Tech`
  const html = buildEmailShell({ greetingAr, greetingEn, bodyAr, bodyEn, ctaAr, ctaEn, inviteUrl })
  return { subject, html }
}

type RfqShareEmailInput = {
  contractorName: string
  rfqTitle: string
  deadline?: string | null
  shareUrl: string
  linkExpiresAt: string
}

// Guest RFQ share link — lets a supplier open the RFQ and submit an offer
// without creating an account. The link itself expires after 3 days.
export function buildRfqShareEmail({
  contractorName,
  rfqTitle,
  deadline,
  shareUrl,
  linkExpiresAt,
}: RfqShareEmailInput): { subject: string; html: string } {
  const safeContractor = escapeHtml(contractorName || "أحد المقاولين على المنصة")
  const safeContractorEn = escapeHtml(contractorName || "A contractor on our platform")
  // RFQ titles can be paragraph-length — keep subject/body readable.
  const shortTitle = rfqTitle.length > 100 ? `${rfqTitle.slice(0, 100).trimEnd()}…` : rfqTitle
  const safeTitle = escapeHtml(shortTitle)

  const expiryAr = new Date(linkExpiresAt).toLocaleDateString("ar-SA", { dateStyle: "long" })
  const expiryEn = new Date(linkExpiresAt).toLocaleDateString("en-US", { dateStyle: "long" })
  const deadlineNoteAr = deadline
    ? ` آخر موعد لاستلام العروض: <strong>${escapeHtml(new Date(deadline).toLocaleDateString("ar-SA", { dateStyle: "long" }))}</strong>.`
    : ""
  const deadlineNoteEn = deadline
    ? ` Offer deadline: <strong>${escapeHtml(new Date(deadline).toLocaleDateString("en-US", { dateStyle: "long" }))}</strong>.`
    : ""

  const bodyAr = `يدعوك <strong>${safeContractor}</strong> لتقديم عرض سعر على طلب عروض الأسعار «<strong>${safeTitle}</strong>» عبر منصة مدماك تيك. يمكنك الاطلاع على كامل التفاصيل وتقديم عرضك مباشرة من الرابط أدناه — دون الحاجة لإنشاء حساب.${deadlineNoteAr} يُرجى العلم أن هذا الرابط صالح حتى <strong>${expiryAr}</strong>.`
  const bodyEn = `<strong>${safeContractorEn}</strong> invites you to submit a price offer for the RFQ "<strong>${safeTitle}</strong>" on Mdmak Tech. You can review the full details and submit your offer directly from the link below — no account required.${deadlineNoteEn} Please note this link is valid until <strong>${expiryEn}</strong>.`

  const subject = `دعوة لتقديم عرض سعر — ${shortTitle || "طلب عروض أسعار"} | RFQ invitation on Mdmak Tech`
  const html = buildEmailShell({
    greetingAr: "مرحباً,",
    greetingEn: "Hello,",
    bodyAr,
    bodyEn,
    ctaAr: "عرض الطلب وتقديم العرض",
    ctaEn: "View RFQ & submit offer",
    inviteUrl: shareUrl,
  })
  return { subject, html }
}

type GuestOfferReceiptEmailInput = {
  companyName: string
  rfqTitle: string
  price: number
  offerUrl: string
}

// Sent to a guest supplier the moment their offer lands: their receipt plus the
// private link they'll use for the rest of the negotiation (price revisions,
// sample confirmation, delivery notice) without ever creating an account.
export function buildGuestOfferReceiptEmail({
  companyName,
  rfqTitle,
  price,
  offerUrl,
}: GuestOfferReceiptEmailInput): { subject: string; html: string } {
  const shortTitle = rfqTitle.length > 100 ? `${rfqTitle.slice(0, 100).trimEnd()}…` : rfqTitle
  const safeTitle = escapeHtml(shortTitle)
  const safeCompany = escapeHtml(companyName || "")
  const priceAr = `${price.toLocaleString("ar-SA")} ر.س`
  const priceEn = `SAR ${price.toLocaleString("en-US")}`

  const bodyAr = `تم استلام عرضكم${safeCompany ? ` المقدّم من <strong>${safeCompany}</strong>` : ""} بمبلغ <strong>${priceAr}</strong> على طلب عروض الأسعار «<strong>${safeTitle}</strong>».<br /><br />احتفظوا بالرابط أدناه: هو صفحتكم الخاصة لمتابعة العرض حتى نهاية التعامل — منها ستتابعون قرار المقاول، وتقدّمون سعراً محدّثاً إذا طُلب تخفيض، وتؤكدون إرسال العينة عند طلبها، وترسلون إشعار التسليم بعد الترسية. لا حاجة لإنشاء حساب.`
  const bodyEn = `We received your offer${safeCompany ? ` from <strong>${safeCompany}</strong>` : ""} of <strong>${priceEn}</strong> for the RFQ "<strong>${safeTitle}</strong>".<br /><br />Keep the link below — it is your private page for the rest of this deal: track the contractor's decision, submit a revised price if a reduction is requested, confirm you sent a requested sample, and send a delivery notice once awarded. No account needed.`

  const subject = `تم استلام عرضكم — ${shortTitle || "طلب عروض أسعار"} | Offer received on Mdmak Tech`
  const html = buildEmailShell({
    greetingAr: "مرحباً,",
    greetingEn: "Hello,",
    bodyAr,
    bodyEn,
    ctaAr: "متابعة العرض",
    ctaEn: "Track your offer",
    inviteUrl: offerUrl,
  })
  return { subject, html }
}

type GuestOfferEventEmailInput = {
  event:
    | "reduction_requested"
    | "sample_requested"
    | "sample_received"
    | "offer_accepted"
    | "offer_rejected"
    | "supply_completed"
  contractorName: string
  rfqTitle: string
  offerUrl: string
  targetPrice?: number | null
  note?: string | null
}

// Contractor → guest supplier: every step of the RFQ workflow that a
// registered supplier would receive as an in-app notification, delivered by
// email instead with a CTA back into their private offer page.
export function buildGuestOfferEventEmail({
  event,
  contractorName,
  rfqTitle,
  offerUrl,
  targetPrice,
  note,
}: GuestOfferEventEmailInput): { subject: string; html: string } {
  const shortTitle = rfqTitle.length > 100 ? `${rfqTitle.slice(0, 100).trimEnd()}…` : rfqTitle
  const safeTitle = escapeHtml(shortTitle)
  const safeContractor = escapeHtml(contractorName || "المقاول")
  const safeContractorEn = escapeHtml(contractorName || "The contractor")
  const safeNote = note ? escapeHtml(note) : null

  const targetAr =
    targetPrice != null
      ? `<br />السعر المستهدف: <strong>${targetPrice.toLocaleString("ar-SA")} ر.س</strong>`
      : ""
  const targetEn =
    targetPrice != null
      ? `<br />Target price: <strong>SAR ${targetPrice.toLocaleString("en-US")}</strong>`
      : ""
  const noteAr = safeNote ? `<br />ملاحظة المقاول: «${safeNote}»` : ""
  const noteEn = safeNote ? `<br />Contractor's note: "${safeNote}"` : ""

  const copy: Record<
    GuestOfferEventEmailInput["event"],
    { subjectAr: string; subjectEn: string; bodyAr: string; bodyEn: string; ctaAr: string; ctaEn: string }
  > = {
    reduction_requested: {
      subjectAr: "طلب تخفيض السعر",
      subjectEn: "Price reduction requested",
      bodyAr: `طلب <strong>${safeContractor}</strong> تخفيض سعر عرضكم على طلب عروض الأسعار «<strong>${safeTitle}</strong>».${targetAr}${noteAr}<br /><br />يمكنكم تقديم سعر محدّث مباشرة من صفحة العرض الخاصة بكم عبر الزر أدناه.`,
      bodyEn: `<strong>${safeContractorEn}</strong> has requested a price reduction on your offer for the RFQ "<strong>${safeTitle}</strong>".${targetEn}${noteEn}<br /><br />You can submit a revised price straight from your private offer page using the button below.`,
      ctaAr: "تقديم سعر محدّث",
      ctaEn: "Submit a revised price",
    },
    sample_requested: {
      subjectAr: "طلب عينة",
      subjectEn: "Sample requested",
      bodyAr: `طلب <strong>${safeContractor}</strong> عينة من المنتج قبل اعتماد عرضكم على طلب عروض الأسعار «<strong>${safeTitle}</strong>».${noteAr}<br /><br />بعد إرسال العينة، أكّدوا ذلك من صفحة العرض ليصل الإشعار للمقاول فوراً.`,
      bodyEn: `<strong>${safeContractorEn}</strong> has requested a product sample before deciding on your offer for the RFQ "<strong>${safeTitle}</strong>".${noteEn}<br /><br />Once you've sent it, confirm from your offer page so the contractor is notified immediately.`,
      ctaAr: "تأكيد إرسال العينة",
      ctaEn: "Confirm sample sent",
    },
    sample_received: {
      subjectAr: "تم استلام العينة",
      subjectEn: "Sample received",
      bodyAr: `أكّد <strong>${safeContractor}</strong> استلام العينة الخاصة بعرضكم على طلب عروض الأسعار «<strong>${safeTitle}</strong>». عرضكم الآن قيد المراجعة النهائية.`,
      bodyEn: `<strong>${safeContractorEn}</strong> confirmed receiving your sample for the RFQ "<strong>${safeTitle}</strong>". Your offer is now under final review.`,
      ctaAr: "متابعة العرض",
      ctaEn: "Track your offer",
    },
    offer_accepted: {
      subjectAr: "🎉 تم قبول عرضكم",
      subjectEn: "Your offer was accepted",
      bodyAr: `تهانينا — قَبِل <strong>${safeContractor}</strong> عرضكم على طلب عروض الأسعار «<strong>${safeTitle}</strong>».${noteAr}<br /><br />الخطوة التالية: عند شحن الطلب، أرسلوا إشعار التسليم من صفحة العرض ليتمكن المقاول من تأكيد الاستلام.`,
      bodyEn: `Congratulations — <strong>${safeContractorEn}</strong> accepted your offer for the RFQ "<strong>${safeTitle}</strong>".${noteEn}<br /><br />Next step: when you ship, send a delivery notice from your offer page so the contractor can confirm receipt.`,
      ctaAr: "فتح صفحة العرض",
      ctaEn: "Open your offer page",
    },
    offer_rejected: {
      subjectAr: "تحديث بخصوص عرضكم",
      subjectEn: "Update on your offer",
      bodyAr: `نأسف لإبلاغكم بأن <strong>${safeContractor}</strong> لم يعتمد عرضكم على طلب عروض الأسعار «<strong>${safeTitle}</strong>».${noteAr}<br /><br />نتطلع لمشاركتكم في طلبات عروض الأسعار القادمة.`,
      bodyEn: `We're sorry to let you know that <strong>${safeContractorEn}</strong> did not select your offer for the RFQ "<strong>${safeTitle}</strong>".${noteEn}<br /><br />We look forward to your participation in upcoming RFQs.`,
      ctaAr: "عرض التفاصيل",
      ctaEn: "View details",
    },
    supply_completed: {
      subjectAr: "🎉 تم تأكيد اكتمال التوريد",
      subjectEn: "Supply confirmed as complete",
      bodyAr: `أكّد <strong>${safeContractor}</strong> اكتمال التوريد الخاص بعرضكم على طلب عروض الأسعار «<strong>${safeTitle}</strong>». شكراً لتعاملكم معنا.`,
      bodyEn: `<strong>${safeContractorEn}</strong> confirmed that the supply for your offer on the RFQ "<strong>${safeTitle}</strong>" is complete. Thank you for working with us.`,
      ctaAr: "عرض التفاصيل",
      ctaEn: "View details",
    },
  }

  const c = copy[event]
  const subject = `${c.subjectAr} — ${shortTitle || "طلب عروض أسعار"} | ${c.subjectEn} on Mdmak Tech`
  const html = buildEmailShell({
    greetingAr: "مرحباً,",
    greetingEn: "Hello,",
    bodyAr: c.bodyAr,
    bodyEn: c.bodyEn,
    ctaAr: c.ctaAr,
    ctaEn: c.ctaEn,
    inviteUrl: offerUrl,
  })
  return { subject, html }
}

type AccountCreatedEmailInput = {
  name: string
  role: "Contractor" | "Supplier"
  setPasswordUrl: string
}

export function buildAccountCreatedEmail({
  name,
  role,
  setPasswordUrl,
}: AccountCreatedEmailInput): { subject: string; html: string } {
  const safeName = escapeHtml(name || "")
  const greetingAr = safeName ? `مرحباً ${safeName},` : "مرحباً,"
  const greetingEn = safeName ? `Hello ${safeName},` : "Hello,"

  const roleAr = role === "Supplier" ? "كمورّد" : "كمقاول"
  const roleEn = role === "Supplier" ? "supplier" : "contractor"

  const bodyAr = `بعد مراجعة طلبك، قام فريقنا بإنشاء حسابك ${roleAr} على منصة مدماك تيك. لتفعيل الدخول، يرجى تعيين كلمة مرور لحسابك عبر الرابط أدناه.`
  const bodyEn = `After reviewing your request, our team created your ${roleEn} account on Mdmak Tech. To activate access, please set a password for your account using the link below.`

  const ctaAr = "تعيين كلمة المرور"
  const ctaEn = "Set your password"

  const subject = "تم إنشاء حسابك في مدماك تيك — Your Mdmak Tech account is ready"
  const html = buildEmailShell({ greetingAr, greetingEn, bodyAr, bodyEn, ctaAr, ctaEn, inviteUrl: setPasswordUrl })
  return { subject, html }
}
