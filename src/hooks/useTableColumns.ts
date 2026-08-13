"use client"

import { useCallback, useEffect, useState } from "react"

export interface TableColumnDef {
  id: string
  /** Already-translated display label — caller resolves i18n before passing in. */
  label: string
  /** Columns the user can't hide (checkboxes, actions, primary label). */
  locked?: boolean
}

function storageKey(tableId: string) {
  return `mdmak_table_columns_${tableId}`
}

/**
 * Per-browser column visibility preference for a table, keyed by tableId.
 * Locked columns are always visible regardless of stored state.
 */
export function useTableColumns(tableId: string, columns: TableColumnDef[]) {
  const allIds = columns.map((c) => c.id)
  const [visible, setVisible] = useState<Set<string>>(new Set(allIds))
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(tableId))
      if (raw) {
        const stored = JSON.parse(raw) as string[]
        const lockedIds = columns.filter((c) => c.locked).map((c) => c.id)
        setVisible(new Set([...stored.filter((id) => allIds.includes(id)), ...lockedIds]))
      }
    } catch {
      // ignore malformed/inaccessible storage — falls back to all-visible
    }
    setHydrated(true)
  }, [tableId])

  const toggle = useCallback(
    (columnId: string) => {
      const col = columns.find((c) => c.id === columnId)
      if (col?.locked) return
      setVisible((prev) => {
        const next = new Set(prev)
        if (next.has(columnId)) next.delete(columnId)
        else next.add(columnId)
        try {
          window.localStorage.setItem(storageKey(tableId), JSON.stringify(Array.from(next)))
        } catch {
          // ignore
        }
        return next
      })
    },
    [columns, tableId]
  )

  const isVisible = useCallback((columnId: string) => visible.has(columnId), [visible])

  return { isVisible, toggle, hydrated }
}
