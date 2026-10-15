"use client"

import { useState, type ComponentProps } from "react"
import { Button } from "@/components/ui/button"
import { PhoneSignInDialog } from "./PhoneSignInDialog"

export function JoinFreeButton({ mode = "signup", ...props }: Omit<ComponentProps<typeof Button>, "onClick" | "type"> & { mode?: "signup" | "signin" }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" {...props} onClick={() => setOpen(true)} />
      <PhoneSignInDialog open={open} onOpenChange={setOpen} mode={mode} />
    </>
  )
}
