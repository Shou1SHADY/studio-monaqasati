"use client"

import { Fragment, useMemo, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronsDownUp, ChevronsUpDown, Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { defaultExpandedIds, expandableIds, type TreeNode } from "@/lib/accounting/statement-tree"
import { Money } from "./AccountingShell"

/**
 * A financial statement as an expandable tree. Every row with detail under it
 * gets a +/− toggle; "Expand all" and "Collapse all" open or fold the whole
 * statement. Clicking any figure (its label or amount) hands the node to
 * `onSelect`, which the statement pages use to open the account breakdown.
 *
 * Groups print like a statement is read: expanded, a heading, its lines and a
 * subtotal row; collapsed, one row carrying the subtotal.
 */
export function StatementTreeTable({
  nodes,
  onSelect,
  headerExtra,
  caption,
  initialDepth,
}: {
  nodes: TreeNode[]
  onSelect?: (node: TreeNode) => void
  /** Rendered beside the expand controls (e.g. the scale caption). */
  headerExtra?: ReactNode
  caption?: string
  /** How many group levels start open: 0 = headings only, 1 = one level in; omit for all. */
  initialDepth?: number
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const allIds = useMemo(() => expandableIds(nodes), [nodes])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpandedIds(nodes, initialDepth)))

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const label = (n: TreeNode, which: "main" | "total" = "main") =>
    which === "total" ? (locale === "ar" ? n.totalLabelAr : n.totalLabelEn) || "" : locale === "ar" ? n.labelAr : n.labelEn

  const renderRows = (list: TreeNode[], depth: number): ReactNode =>
    list.map((node) => {
      const hasChildren = !!node.children && node.children.length > 0
      const isOpen = hasChildren && expanded.has(node.id)
      const clickable = !!onSelect && !!node.codes && node.codes.length > 0
      const indent = { paddingInlineStart: `${12 + depth * 20}px` }

      const toggleButton = hasChildren ? (
        <button
          type="button"
          onClick={() => toggle(node.id)}
          aria-expanded={isOpen}
          aria-label={t(isOpen ? "acc_tree_collapse_row" : "acc_tree_expand_row", { label: label(node) })}
          className="h-5 w-5 shrink-0 grid place-items-center rounded border border-slate-300 bg-white text-slate-600 hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isOpen ? <Minus size={11} strokeWidth={3} /> : <Plus size={11} strokeWidth={3} />}
        </button>
      ) : (
        <span className="h-5 w-5 shrink-0" aria-hidden="true" />
      )

      const labelContent = (text: string) => (
        <>
          {node.accountCode && (
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums shrink-0" dir="ltr">
              {node.accountCode}
            </span>
          )}
          <span className="min-w-0">{text}</span>
        </>
      )

      const labelCell = (text: string) =>
        clickable ? (
          <button
            type="button"
            onClick={() => onSelect!(node)}
            className="flex items-center gap-2 text-start min-w-0 rounded hover:text-primary hover:underline underline-offset-4 decoration-dotted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={t("acc_tree_open_breakdown")}
          >
            {labelContent(text)}
          </button>
        ) : (
          <span className="flex items-center gap-2 min-w-0">{labelContent(text)}</span>
        )

      const valueCell = (value: number | null) =>
        value === null ? null : clickable ? (
          <button
            type="button"
            onClick={() => onSelect!(node)}
            className="rounded hover:text-primary hover:underline underline-offset-4 decoration-dotted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("acc_tree_open_breakdown_for", { label: label(node) })}
          >
            <Money value={value} />
          </button>
        ) : (
          <Money value={value} />
        )

      if (node.kind === "group") {
        if (!isOpen) {
          return (
            <tr key={node.id} className={cn("border-t font-bold", depth === 0 ? "bg-muted/40" : "bg-muted/20")}>
              <td className="py-2.5 pe-4" style={indent}>
                <div className="flex items-center gap-2">
                  {toggleButton}
                  {labelCell(label(node))}
                </div>
              </td>
              <td className="px-5 py-2.5 text-end">{valueCell(node.value)}</td>
            </tr>
          )
        }
        return (
          <Fragment key={node.id}>
            <tr className={cn("border-t", depth === 0 ? "bg-muted/40" : "bg-muted/20")}>
              <td colSpan={2} className="py-2 pe-4 text-xs font-black text-muted-foreground" style={indent}>
                <div className="flex items-center gap-2">
                  {toggleButton}
                  {labelCell(label(node))}
                </div>
              </td>
            </tr>
            {renderRows(node.children!, depth + 1)}
            <tr className="border-t font-bold bg-muted/20">
              <td className="py-2.5 pe-4" style={indent}>
                <div className="flex items-center gap-2">
                  <span className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {labelCell(label(node, "total") || label(node))}
                </div>
              </td>
              <td className="px-5 py-2.5 text-end">{valueCell(node.value)}</td>
            </tr>
          </Fragment>
        )
      }

      return (
        <Fragment key={node.id}>
          <tr
            className={cn(
              "border-t",
              node.kind === "total" && "bg-primary/5 font-black",
              node.kind === "account" && depth > 0 && "text-xs text-muted-foreground bg-slate-50/60"
            )}
          >
            <td className={cn("py-2.5 pe-4", node.kind === "line" && depth > 0 && "text-slate-700")} style={indent}>
              <div className="flex items-center gap-2">
                {toggleButton}
                {labelCell(label(node))}
              </div>
            </td>
            <td className="px-5 py-2.5 text-end">{valueCell(node.value)}</td>
          </tr>
          {isOpen && renderRows(node.children!, depth + 1)}
        </Fragment>
      )
    })

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b bg-white">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setExpanded(new Set(allIds))}
            disabled={allIds.length === 0 || expanded.size === allIds.length}
          >
            <ChevronsUpDown size={13} aria-hidden="true" />
            {t("acc_tree_expand_all")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setExpanded(new Set())}
            disabled={expanded.size === 0}
          >
            <ChevronsDownUp size={13} aria-hidden="true" />
            {t("acc_tree_collapse_all")}
          </Button>
        </div>
        <div className="flex items-center gap-3">
          {onSelect && <span className="text-[11px] text-muted-foreground hidden sm:inline">{t("acc_tree_click_hint")}</span>}
          {headerExtra}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <tbody>{renderRows(nodes, 0)}</tbody>
        </table>
      </div>
    </div>
  )
}
