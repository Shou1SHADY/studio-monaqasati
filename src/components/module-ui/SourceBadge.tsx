import { COMPONENT_ACCENT_CLASSES, CONTRACTOR_COMPONENTS, type PortalComponentId } from "@/lib/portal-components"
import { cn } from "@/lib/utils"

/** Which module a record or a wait comes from, in that module's own colour —
 * read from the registry, so a badge can never disagree with the module's tile. */
export function SourceBadge({ module, label, className }: { module: PortalComponentId; label: string; className?: string }) {
  const accent = CONTRACTOR_COMPONENTS.find((c) => c.id === module)?.accentToken ?? "secondary"
  return <span className={cn("inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold", COMPONENT_ACCENT_CLASSES[accent].tile, className)}>{label}</span>
}
