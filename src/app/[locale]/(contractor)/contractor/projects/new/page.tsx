"use client"

// «مشروع جديد» (the PM 1.0 prototype's formPrj without a file): the exception
// path beside a CRM handover — a direct order, an internal project, a migration.
// Only a holder of the PM `create` key reaches it (a site engineer has none);
// the project is born a PM 1.0 project, exactly as an accepted handover is.

import { FolderLock, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { AcceptHandoverWizard } from "@/components/pm/AcceptHandoverWizard"
import { useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { usePmAccess } from "@/hooks/usePmAccess"
import { Link, useRouter } from "@/i18n/routing"

export default function NewProjectPage() {
  const t = useTranslations("Portal.PM")
  const router = useRouter()
  const { user } = useUser()
  const { profile, isOrgOwner } = usePermissions()
  const portfolio = usePmAccess(undefined, null)
  const orgId = (profile?.organizationId as string | undefined) || user?.uid || ""
  const actor = { uid: user?.uid ?? "", name: ((profile as { name?: string } | null)?.name as string) || user?.email || null, owner: isOrgOwner }

  return (
    <PortalLayout>
      {portfolio.isLoading || !user ? (
        <div className="flex items-center justify-center p-20 text-muted-foreground">
          <Loader2 className="animate-spin" size={32} aria-hidden="true" />
        </div>
      ) : !portfolio.has("create") ? (
        <EmptyState
          icon={FolderLock}
          title={t("manual.no_create_title")}
          description={t("manual.no_create_body")}
          action={
            <Button asChild variant="outline">
              <Link href="/contractor/projects">{t("head.crumb_projects")}</Link>
            </Button>
          }
        />
      ) : (
        <AcceptHandoverWizard open handover={null} organizationId={orgId} ctx={portfolio.ctx} actor={actor} onOpenChange={(o) => !o && router.push("/contractor/projects")} />
      )}
    </PortalLayout>
  )
}
