"use client"

// Which projects the viewer may see (PRD §3, TM-01): the owner and a ceiling
// holding `all` see every project; anyone else sees a PM 1.0 project only while
// they hold a live seat on its team. A legacy project (no `pm` block) has no
// seats and stays visible as before.

import { useEffect, useMemo, useState } from "react"
import { doc, getDoc } from "firebase/firestore"
import { useFirestore, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { pmCeiling, seatActive, seatFromMember } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"

type ProjectLike = { id: string; pm?: unknown }

export function usePmVisibleProjects<P extends ProjectLike>(projects: P[]): { visible: P[]; isLoading: boolean } {
  const firestore = useFirestore()
  const { user } = useUser()
  const { isOrgOwner, profile, groups, isLoading: permLoading } = usePermissions()
  const defaultGroupId = (profile?.defaultGroupId as string | undefined) ?? null
  const seesAll = useMemo(() => {
    const group = groups.find((g) => g.id === defaultGroupId)
    return pmCeiling({ owner: isOrgOwner, permissions: group?.permissions ?? [] }).has("all")
  }, [groups, defaultGroupId, isOrgOwner])

  const pmIds = useMemo(() => projects.filter((p) => p.pm).map((p) => p.id).sort().join(","), [projects])
  const [seated, setSeated] = useState<{ key: string; ids: Set<string> } | null>(null)
  const key = `${user?.uid ?? ""}|${pmIds}`

  useEffect(() => {
    if (permLoading || seesAll || !firestore || !user?.uid || !pmIds) return
    let live = true
    const uid = user.uid
    const today = todayDay()
    Promise.all(
      pmIds.split(",").map(async (id) => {
        const snap = await getDoc(doc(firestore, "projects", id, "members", uid)).catch(() => null)
        const seat = snap?.exists() ? seatFromMember(snap.data(), uid) : null
        return seat && seatActive(seat, today) ? id : null
      })
    ).then((ids) => {
      if (live) setSeated({ key, ids: new Set(ids.filter((x): x is string => Boolean(x))) })
    })
    return () => {
      live = false
    }
  }, [permLoading, seesAll, firestore, user?.uid, pmIds, key])

  return useMemo(() => {
    if (permLoading) return { visible: [], isLoading: true }
    if (seesAll || !pmIds) return { visible: projects, isLoading: false }
    if (!seated || seated.key !== key) return { visible: projects.filter((p) => !p.pm), isLoading: true }
    return { visible: projects.filter((p) => !p.pm || seated.ids.has(p.id)), isLoading: false }
  }, [permLoading, seesAll, pmIds, projects, seated, key])
}
