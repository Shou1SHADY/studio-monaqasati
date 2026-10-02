import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function ShowMoreRow({ onClick, children, className }: { onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("w-full border-t py-3 text-sm font-bold text-module transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", className)}
    >
      {children}
    </button>
  )
}
