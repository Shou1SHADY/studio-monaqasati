"use client"

import { CheckCircle2, Eye, Layers, ShieldOff } from "lucide-react"
import { IconButton } from "@/components/module-ui/IconButton"
import { cn } from "@/lib/utils"

/**
 * The actions of one account row in the admin tables, as three icon buttons with tooltips instead of three labelled
 * buttons: the row fits the screen, every account has the same set, and a disabled Verify says why.
 */
export function AccountRowActions({
  labels,
  verified,
  canVerify,
  onView,
  onComponents,
  onVerify,
}: {
  labels: { view: string; components: string; verify: string; unverify: string; needsDocs: string }
  verified: boolean
  canVerify: boolean
  onView: () => void
  onComponents: () => void
  onVerify: (verify: boolean) => void
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <IconButton variant="outline" label={labels.view} icon={Eye} onClick={onView} />
      <IconButton variant="outline" label={labels.components} icon={Layers} onClick={onComponents} />
      {verified ? (
        <IconButton variant="outline" label={labels.unverify} icon={ShieldOff} onClick={() => onVerify(false)} className="border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive" />
      ) : (
        <span title={canVerify ? undefined : labels.needsDocs} className={cn("inline-flex", !canVerify && "cursor-not-allowed")}>
          <IconButton variant="default" label={canVerify ? labels.verify : `${labels.verify} — ${labels.needsDocs}`} icon={CheckCircle2} disabled={!canVerify} onClick={() => onVerify(true)} title={canVerify ? labels.verify : undefined} />
        </span>
      )}
    </div>
  )
}
