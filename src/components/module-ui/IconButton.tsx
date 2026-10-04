import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type IconButtonProps = Omit<ButtonProps, "children" | "size" | "aria-label"> & {
  /** What the button does, in the viewer's language: the accessible name and the tooltip. */
  label: string
  icon: LucideIcon
  iconSize?: number
}

/** An icon-only button. The label is required, so no icon-only control ships without a name. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(({ label, icon: Icon, iconSize = 16, variant = "ghost", className, type = "button", ...props }, ref) => (
  <Button ref={ref} type={type} variant={variant} size="icon" aria-label={label} title={label} className={cn("h-11 w-11 md:h-10 md:w-10", className)} {...props}>
    <Icon size={iconSize} aria-hidden="true" />
  </Button>
))
IconButton.displayName = "IconButton"
