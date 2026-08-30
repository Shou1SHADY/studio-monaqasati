import { getTranslations } from "next-intl/server"
import { IS_UAT } from "@/lib/app-env"

/**
 * A thin strip at the very top of every page on non-production deployments,
 * so a tester — or a customer who was sent the wrong link — can never mistake
 * UAT for the live site. Renders nothing in production.
 *
 * It sits in normal document flow on purpose. The portal header is
 * `sticky top-0`; a `fixed` ribbon fought it for the same 28px and covered
 * the search box and the language switcher. In flow, the ribbon owns its own
 * strip above the header and scrolls away with the page, and nothing is ever
 * drawn underneath it.
 */
export async function EnvironmentRibbon() {
  if (!IS_UAT) return null
  const t = await getTranslations("Portal.Shared")
  return (
    <div
      role="status"
      className="flex w-full items-center justify-center gap-2 bg-warning px-3 py-1 text-center text-[11px] font-bold leading-tight text-warning-foreground"
    >
      <span className="rounded-sm bg-warning-foreground/15 px-1.5 py-0.5 tracking-latin">UAT</span>
      <span>{t("env_ribbon_uat")}</span>
    </div>
  )
}
