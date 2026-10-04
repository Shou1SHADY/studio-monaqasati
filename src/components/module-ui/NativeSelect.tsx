import * as React from "react"
import { cn } from "@/lib/utils"

/** The browser's own select, styled once. Use it where a native picker is wanted (long lists, mobile); otherwise the shadcn Select. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-10 rounded-lg border bg-background px-3 text-sm",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
))
NativeSelect.displayName = "NativeSelect"
