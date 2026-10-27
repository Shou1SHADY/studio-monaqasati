"use client"

import { useState, type ComponentProps } from "react"
import { Button } from "@/components/ui/button"
import { PhoneSignInDialog } from "./PhoneSignInDialog"

export function JoinFreeButton({ mode = "signup", initialPhone, source, ...props }: Omit<ComponentProps<typeof Button>, "onClick" | "type"> & { mode?: "signup" | "signin"; initialPhone?: string; source?: "self" }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" {...props} onClick={() => setOpen(true)} />
      <PhoneSignInDialog open={open} onOpenChange={setOpen} mode={mode} initialPhone={initialPhone} source={source} />
    </>
  )
}
