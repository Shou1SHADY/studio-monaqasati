"use client"

import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { usePermissions } from "@/hooks/usePermissions"
import { OwnerOnlyNotice } from "@/components/OwnerOnlyNotice"

// DEV-60: a member's children never mount, so they neither render nor subscribe to documents the rules refuse him.
export function OwnerOnlyGate({ children }: { children: ReactNode }) {
  const { isOrgOwner, isLoading } = usePermissions()
  if (isLoading) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={28} aria-hidden="true" />
      </div>
    )
  }
  return isOrgOwner ? <>{children}</> : <OwnerOnlyNotice />
}
