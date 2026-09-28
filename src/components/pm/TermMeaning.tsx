"use client"

// Each contract term with what it means today and what follows from it — the
// difference between a setting and a term is that a term has a price
// (the prototype's termsMain rows). Money only for holders of money.

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { pmMoney, pmPct } from "@/lib/pm/format"
import type { ContractTerms, TermKey } from "@/lib/pm/terms"

export function useTermMeaning({ contractValue, retentionHeld, money, advanceRecovered }: { contractValue: number; retentionHeld: number; money: boolean; advanceRecovered?: number }) {
  const t = useTranslations("Portal.PM")
  const amount = useCallback((n: number) => (money ? pmMoney(n) : "•••"), [money])
  return useCallback(
    (key: TermKey, terms: ContractTerms): { note?: string; warn?: string } => {
      switch (key) {
        case "payer":
          return { note: t(`terms.mean.payer.${terms.payer}`), warn: terms.payer === "none" ? t("terms.warn.payer_none") : undefined }
        case "basis":
          return { note: t(`terms.mean.basis.${terms.basis}`), warn: terms.basis === "lump" ? t("terms.warn.lump") : undefined }
        case "advance":
          if (!(terms.advance > 0)) return { warn: t("terms.warn.no_advance") }
          return {
            note:
              advanceRecovered === undefined
                ? t("terms.mean.advance", { amount: amount(contractValue * terms.advance) })
                : `${t("terms.mean.advance", { amount: amount(contractValue * terms.advance) })} · ${t("terms.mean.advance_left", { amount: amount(Math.max(0, contractValue * terms.advance - advanceRecovered)) })}`,
          }
        case "retention":
          return {
            note: t("terms.mean.retention", { held: amount(retentionHeld) }),
            warn: terms.retentionCap > 0 && retentionHeld >= terms.retentionCap * contractValue - 1 && retentionHeld > 0 ? t("terms.warn.cap_reached") : undefined,
          }
        case "retentionCap":
          return { note: terms.retentionCap < terms.retention ? t("terms.mean.cap_stops", { rate: pmPct(terms.retention), cap: pmPct(terms.retentionCap) }) : t("terms.mean.cap_not_reached") }
        case "paymentDays": {
          const cycle = terms.paymentDays + terms.consultantDays
          return { note: t("terms.mean.cycle", { days: t("days", { count: terms.consultantDays }), cycle: t("days", { count: cycle }) }), warn: cycle > 60 ? t("terms.warn.long_cycle") : undefined }
        }
        case "consultantDays":
          return { note: t("terms.mean.consultant") }
        case "damages":
          return { note: terms.damages.on ? t("terms.mean.damages", { cap: pmPct(terms.damages.cap), amount: amount(contractValue * terms.damages.cap) }) : t("terms.mean.no_damages") }
        case "claimNoticeDays":
          return { note: t("terms.mean.notice") }
        case "defectsDays":
          return { note: t("terms.mean.defects") }
        default:
          return {}
      }
    },
    [t, amount, contractValue, retentionHeld, advanceRecovered]
  )
}
