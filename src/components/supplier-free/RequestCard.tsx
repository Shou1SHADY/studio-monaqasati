"use client"

// A quote request as the free supplier scans dozens of them (PRD RFQ-06/07): a compact card — invitation, new,
// the deadline coloured by urgency, a title in two lines, the contractor and district, the first item with its
// quantity, "needed by", Send quote and Not for me — and the same data as a two-line row.

import { Archive, ArchiveRestore } from "lucide-react"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { displayCategory } from "@/lib/constants"
import type { Deal } from "@/lib/supplier-free/types"
import type { Free } from "./useFree"
import { DeadlinePill, Pill, VerifiedMark, dealPlace } from "./ui"

interface Props {
  f: Free
  d: Deal
  href: (patch: Record<string, string | null>) => string
  selected?: boolean
  onSelect?: (id: string, on: boolean) => void
  onArchive?: (id: string, on: boolean) => void
}

function Tags({ f, d }: { f: Free; d: Deal }) {
  return (
    <>
      {d.channel === "invite" && <Pill tone="violet">{f.t("inviteShort")}</Pill>}
      {f.L.isNewReq(d) && <span className="rounded-full bg-cta px-2 py-0.5 text-[10px] font-black text-white">{f.t("newTag")}</span>}
    </>
  )
}

function FirstItem({ f, d }: { f: Free; d: Deal }) {
  const i0 = d.items[0]
  if (!i0) return null
  return (
    <p className="text-sm leading-snug">
      <b className="tabular-nums" dir="ltr">
        {f.fmt.n(i0.qty)} {i0.unit}
      </b>{" "}
      <bdi>{i0.name}</bdi>
      {d.items.length > 1 && <span className="ms-1 text-xs text-muted-foreground">{f.t("plusMore", { n: f.pl("pl_item", d.items.length - 1) })}</span>}
    </p>
  )
}

export function RequestCard({ f, d, href, selected, onSelect, onArchive }: Props) {
  const c = f.L.C(d.c)
  const archived = !!f.world.arch[d.id]
  return (
    <article
      className={cn(
        "relative flex flex-col gap-2 rounded-xl border bg-card p-3.5 transition-shadow hover:shadow-md",
        d.channel === "invite" && "border-s-4 border-s-violet",
        selected && "ring-2 ring-module"
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {onSelect && (
          <input type="checkbox" checked={!!selected} onChange={(e) => onSelect(d.id, e.target.checked)} aria-label={f.t("selOne")} className="h-4 w-4 accent-[hsl(var(--module))]" />
        )}
        <Tags f={f} d={d} />
        <span className="flex-1" />
        <DeadlinePill f={f} iso={d.deadline} />
      </div>
      <Link href={href({ deal: d.id }) as never} scroll={false} className="line-clamp-2 text-start text-sm font-bold leading-snug text-foreground hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
        {d.title}
      </Link>
      <p className="text-xs text-muted-foreground">
        <bdi>{c ? c.name : "—"}</bdi> <VerifiedMark f={f} verified={!!c?.verified} /> · <bdi>{dealPlace(d)}</bdi>
      </p>
      <FirstItem f={f} d={d} />
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <span className="me-auto text-[11px] text-muted-foreground">{f.t("fNeedByShort", { x: f.fmt.date(d.needBy) })}</span>
        <Link
          href={href({ quote: d.id, mode: "new" }) as never}
          scroll={false}
          className="inline-flex h-8 items-center rounded-lg bg-cta px-3 text-xs font-bold text-cta-foreground hover:bg-cta/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {f.t("btnOffer")}
        </Link>
        {onArchive && (
          <button
            type="button"
            onClick={() => onArchive(d.id, !archived)}
            title={archived ? f.t("unarchive") : f.t("notForMe")}
            aria-label={archived ? f.t("unarchive") : f.t("notForMe")}
            className="grid h-8 w-8 place-items-center rounded-lg border text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {archived ? <ArchiveRestore size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}
          </button>
        )}
      </div>
    </article>
  )
}

export function RequestRow({ f, d, href, selected, onSelect, onArchive }: Props) {
  const c = f.L.C(d.c)
  const archived = !!f.world.arch[d.id]
  const i0 = d.items[0]
  return (
    <tr className={cn("border-b last:border-b-0 hover:bg-muted/30", selected && "bg-module/5")}>
      <td className="w-9 ps-3">
        {onSelect && <input type="checkbox" checked={!!selected} onChange={(e) => onSelect(d.id, e.target.checked)} aria-label={f.t("selOne")} className="h-4 w-4 accent-[hsl(var(--module))]" />}
      </td>
      <td className="max-w-[320px] px-3 py-2.5">
        <Link href={href({ deal: d.id }) as never} scroll={false} className="block truncate text-sm font-bold hover:text-module" dir="auto">
          {d.title}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Tags f={f} d={d} />
          <bdi>{c ? c.name : "—"}</bdi> <VerifiedMark f={f} verified={!!c?.verified} /> · <bdi>{d.city}</bdi>
        </p>
      </td>
      <td className="hidden px-3 text-xs xl:table-cell">{displayCategory(d.cat, f.locale)}</td>
      <td className="px-3 text-xs">
        {i0 && (
          <>
            <b className="tabular-nums" dir="ltr">
              {f.fmt.n(i0.qty)} {i0.unit}
            </b>
            <p className="truncate text-muted-foreground">
              <bdi>{i0.name}</bdi>
              {d.items.length > 1 && ` ${f.t("plusMore", { n: f.pl("pl_item", d.items.length - 1) })}`}
            </p>
          </>
        )}
      </td>
      <td className="hidden whitespace-nowrap px-3 text-xs md:table-cell">{f.fmt.date(d.needBy)}</td>
      <td className="px-3">
        <DeadlinePill f={f} iso={d.deadline} />
      </td>
      <td className="whitespace-nowrap px-3 text-end">
        <Link href={href({ quote: d.id, mode: "new" }) as never} scroll={false} className="inline-flex h-8 items-center rounded-lg bg-cta px-3 text-xs font-bold text-cta-foreground hover:bg-cta/90">
          {f.t("btnOffer")}
        </Link>
        {onArchive && (
          <button
            type="button"
            onClick={() => onArchive(d.id, !archived)}
            title={archived ? f.t("unarchive") : f.t("notForMe")}
            aria-label={archived ? f.t("unarchive") : f.t("notForMe")}
            className="ms-1.5 inline-grid h-8 w-8 place-items-center rounded-lg border text-muted-foreground hover:text-foreground"
          >
            {archived ? <ArchiveRestore size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}
          </button>
        )}
      </td>
    </tr>
  )
}
