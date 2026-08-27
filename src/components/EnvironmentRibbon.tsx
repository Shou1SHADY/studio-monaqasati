import { getTranslations } from "next-intl/server"
import { IS_UAT } from "@/lib/app-env"

/**
 * A fixed strip at the top of every page on non-production deployments, so a
 * tester — or a customer who was sent the wrong link — can never mistake UAT
 * for the live site. Renders nothing in production.
 */
export async function EnvironmentRibbon() {
  if (!IS_UAT) return null
  const t = await getTranslations("Portal.Shared")
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-warning px-3 py-1 text-center text-[11px] font-bold text-warning-foreground shadow-md"
    >
      <span className="rounded-sm bg-warning-foreground/15 px-1.5 py-0.5 tracking-latin">UAT</span>
      <span>{t("env_ribbon_uat")}</span>
    </div>
  )
}
