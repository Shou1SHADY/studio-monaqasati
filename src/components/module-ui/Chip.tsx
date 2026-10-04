import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type ChipProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> & {
  selected: boolean
  count?: number | string
  icon?: LucideIcon
}

/** A filter or toggle chip: one look for every "show only these" control, pressed state announced. */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(({ selected, count, icon: Icon, className, children, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    aria-pressed={selected}
    className={cn(
      "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
      selected
        ? "border-primary bg-primary text-primary-foreground"
        : "bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      className,
    )}
    {...props}
  >
    {Icon && <Icon size={14} aria-hidden="true" />}
    {children}
    {count !== undefined && (
      <span className="opacity-80 tabular-nums" dir="ltr">
        {count}
      </span>
    )}
  </button>
))
Chip.displayName = "Chip"
