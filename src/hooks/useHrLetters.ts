"use client"

// HR 1.0 — the letters a viewer may read, the way the rules let him (EM-08):
// pay roles read them all; government relations reads the letters it signs;
// everyone reads his own. A letter carries no pay — a salary or embassy
// letter's figures are read apart (`useLetterPay`), by pay roles and the
// employee only (RL-03).

import { useMemo } from "react"
import { collection, doc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import type { HrAccess } from "@/hooks/useHrAccess"
import { HR_LETTER_PAY, HR_LETTERS } from "@/lib/hr/collections"
import { isPayLetter, type HrLetter, type LetterPay } from "@/lib/hr/letters"

export function useHrLetters(access: HrAccess) {
  const firestore = useFirestore()
  const orgId = access.orgId
  const all = access.allowed("pay.view")
  const gov = !all && access.ctx.roles.has("gov")
  const uid = access.ctx.uid
  const allQ = useMemoFirebase(() => (firestore && orgId && all ? query(collection(firestore, HR_LETTERS), where("organizationId", "==", orgId)) : null), [firestore, orgId, all])
  const govQ = useMemoFirebase(
    () => (firestore && orgId && gov ? query(collection(firestore, HR_LETTERS), where("organizationId", "==", orgId), where("signerLevel", "==", "gov")) : null),
    [firestore, orgId, gov]
  )
  const ownQ = useMemoFirebase(
    () => (firestore && orgId && !all && uid ? query(collection(firestore, HR_LETTERS), where("organizationId", "==", orgId), where("employeeUserId", "==", uid)) : null),
    [firestore, orgId, all, uid]
  )
  const { data: a, isLoading } = useCollection(allQ)
  const { data: g } = useCollection(govQ)
  const { data: o } = useCollection(ownQ)
  return useMemo(() => {
    const m = new Map<string, HrLetter>()
    for (const l of [...(a ?? []), ...(g ?? []), ...(o ?? [])] as unknown as HrLetter[]) m.set(l.id, l)
    const letters = [...m.values()].sort((x, y) => (y.createdAt ?? "").localeCompare(x.createdAt ?? ""))
    return { letters, isLoading }
  }, [a, g, o, isLoading])
}

/** A salary or embassy letter's figures — null for those who may not see them (RL-03). */
export function useLetterPay(access: HrAccess, letter: Pick<HrLetter, "id" | "kind" | "employeeId"> | null) {
  const firestore = useFirestore()
  const may = Boolean(letter && isPayLetter(letter.kind) && access.seesPay(letter.employeeId))
  const id = letter?.id ?? null
  const ref = useMemoFirebase(() => (firestore && id && may ? doc(firestore, HR_LETTER_PAY, id) : null), [firestore, id, may])
  const { data } = useDoc(ref)
  return { pay: (data as unknown as LetterPay | null) ?? null, hidden: Boolean(letter && isPayLetter(letter.kind) && !may) }
}
