"use client"

// The RFQ editor's page: the portal frame, Procurement's head and tabs, and the two
// gates the old form had — a company whose profile is incomplete, or not yet verified,
// raises no RFQ (only the owner can complete it, DEV-60).

import { useLocale, useTranslations } from "next-intl"
import { AlertCircle, Loader2 } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Button } from "@/components/ui/button"
import { useUser } from "@/firebase"
import { useRouter } from "@/i18n/routing"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { legacyAwareRole } from "@/hooks/usePermissions"
import { REQUIRE_COMPLETE_PROFILE } from "@/lib/app-env"
import { RfqEditor } from "./RfqEditor"

function Gate({ title, body, cta, href }: { title: string; body: string; cta: string | null; href: string }) {
  const router = useRouter()
  const locale = useLocale()
  return (
    <div className="mx-auto mt-12 max-w-md space-y-5 rounded-2xl border bg-card p-8 text-center" dir={locale === "ar" ? "rtl" : "ltr"}>
      <AlertCircle size={32} className="mx-auto text-amber-600" aria-hidden="true" />
      <h1 className="text-xl font-black">{title}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      {cta && (
        <Button className="w-full" onClick={() => router.push(href)}>
          {cta}
        </Button>
      )}
    </div>
  )
}

export function RfqEditorPage({ projectId }: { projectId?: string }) {
  const t = useTranslations("Portal.Contractor")
  const tShared = useTranslations("Portal.Shared")
  const { user, isUserLoading } = useUser()
  const { profile, isLoading } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const isMember = legacyAwareRole(profile as Record<string, unknown> | null) !== "owner"

  let body
  if (isUserLoading || isLoading) {
    body = (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-module" size={32} />
      </div>
    )
  } else if (REQUIRE_COMPLETE_PROFILE && profile && !profile.profileCompleted) {
    body = (
      <Gate
        title={t("newrfq_profile_incomplete")}
        body={isMember ? tShared("company_incomplete_member") : t("newrfq_profile_incomplete_desc")}
        cta={isMember ? null : t("newrfq_go_to_profile")}
        href="/contractor/profile"
      />
    )
  } else if (profile && !profile.isVerified) {
    body = (
      <Gate
        title={t("newrfq_verification_required")}
        body={isMember ? tShared("company_unverified_member") : t("newrfq_verification_required_desc")}
        cta={isMember ? null : t("newrfq_go_to_profile_verify")}
        href="/contractor/profile"
      />
    )
  } else {
    body = <RfqEditor projectId={projectId} />
  }
  return <PortalLayout>{body}</PortalLayout>
}
