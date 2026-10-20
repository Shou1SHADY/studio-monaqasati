"use client"

// Admin → Materials (PUR-04): the platform team's copy of the material tree. Watad's tree
// is imported as it is into `categories` (one document per category); a node is renamed,
// given units, hidden from the pickers (never deleted — documents name it), or given a
// child. Materials typed outside the list wait here to be added, and suppliers who have
// not chosen their specialties from the tree can be told once.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, onSnapshot, setDoc, writeBatch } from "firebase/firestore"
import { getAuth } from "firebase/auth"
import { ChevronDown, Download, EyeOff, FolderTree, Loader2, Megaphone, Plus, Save } from "lucide-react"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { reloadMaterialTree, MATERIAL_TREE_URL } from "@/hooks/useMaterialTree"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Chip } from "@/components/module-ui/Chip"
import { Panel } from "@/components/module-ui/Panel"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { cn } from "@/lib/utils"
import { addChild, findIn, renameNode, setHidden, setUnits } from "@/lib/materials/admin-edit"
import { label, shortSpecName } from "@/lib/materials/tree"
import { MATERIAL_SUGGESTIONS_DOC, MATERIAL_TREE, type MaterialNode, type MaterialRootDoc, type MaterialSuggestion, type MaterialTreeFile, type MaterialUnit } from "@/lib/materials/types"

const UNITS: MaterialUnit[] = [
  { key: "pc", ar: "حبة", en: "piece" },
  { key: "bag", ar: "كيس", en: "bag" },
  { key: "ton", ar: "طن", en: "ton" },
  { key: "kg", ar: "كجم", en: "kg" },
  { key: "m3", ar: "م³", en: "m³" },
  { key: "m2", ar: "م²", en: "m²" },
  { key: "m", ar: "متر", en: "m" },
  { key: "l", ar: "لتر", en: "L" },
  { key: "roll", ar: "لفة", en: "roll" },
  { key: "drum", ar: "برميل", en: "drum" },
  { key: "trip", ar: "نقلة", en: "trip" },
]

const DEPTH: Record<number, string> = { 1: "ps-6", 2: "ps-10" }

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)

export function AdminMaterialsView() {
  const t = useTranslations("Portal.Admin.Materials")
  const tm = useTranslations("Portal.Materials")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const [docs, setDocs] = useState<Array<MaterialRootDoc & { id: string }> | null>(null)
  const [suggestions, setSuggestions] = useState<MaterialSuggestion[]>([])
  const [openRoot, setOpenRoot] = useState<string | null>(null)
  const [sel, setSel] = useState<{ rootId: string; id: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState({ ar: "", en: "" })
  const [child, setChild] = useState({ ar: "", en: "" })

  useEffect(() => {
    if (!firestore) return
    return onSnapshot(collection(firestore, MATERIAL_TREE), (snap) => {
      const roots: Array<MaterialRootDoc & { id: string }> = []
      let sugg: MaterialSuggestion[] = []
      for (const d of snap.docs) {
        if (d.id === MATERIAL_SUGGESTIONS_DOC) sugg = (d.data().items as MaterialSuggestion[] | undefined) || []
        else if ((d.data() as MaterialRootDoc).root) roots.push({ ...(d.data() as MaterialRootDoc), id: d.id })
      }
      setDocs(roots.sort((a, b) => a.order - b.order))
      setSuggestions([...sugg].sort((a, b) => b.lastAt.localeCompare(a.lastAt)))
    })
  }, [firestore])

  const selRoot = sel && docs ? docs.find((d) => d.id === sel.rootId) || null : null
  const selNode = selRoot && sel ? findIn(selRoot.root, sel.id) : null
  useEffect(() => setDraft(selNode ? { ar: selNode.ar, en: selNode.en } : { ar: "", en: "" }), [selNode?.id, selNode?.ar, selNode?.en])

  const counts = useMemo(() => {
    let nodes = 0
    for (const d of docs || []) {
      const walk = (n: MaterialNode) => {
        nodes++
        n.children.forEach(walk)
      }
      walk(d.root)
    }
    return { roots: docs?.length || 0, nodes }
  }, [docs])

  const saveRoot = async (rootDoc: MaterialRootDoc & { id: string }, root: MaterialNode) => {
    if (!firestore) return
    setBusy("save")
    try {
      await setDoc(doc(firestore, MATERIAL_TREE, rootDoc.id), { root, order: rootDoc.order, updatedAt: new Date().toISOString(), updatedBy: user?.uid || null })
      void reloadMaterialTree(firestore)
      toast({ title: t("saved") })
    } catch {
      toast({ title: t("save_failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const importShipped = async () => {
    if (!firestore || !window.confirm(t("import_confirm"))) return
    setBusy("import")
    try {
      const file = (await (await fetch(MATERIAL_TREE_URL)).json()) as MaterialTreeFile
      const batch = writeBatch(firestore)
      const at = new Date().toISOString()
      file.roots.forEach((root, order) => batch.set(doc(firestore, MATERIAL_TREE, root.id), { root, order, updatedAt: at, updatedBy: user?.uid || null }))
      await batch.commit()
      void reloadMaterialTree(firestore)
      toast({ title: t("imported", { count: file.roots.length }) })
    } catch {
      toast({ title: t("save_failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const askSuppliers = async () => {
    const u = getAuth().currentUser
    if (!u || !window.confirm(t("ask_confirm"))) return
    setBusy("ask")
    try {
      const res = await fetch("/api/admin/materials/ask-suppliers", { method: "POST", headers: { Authorization: `Bearer ${await u.getIdToken()}` } })
      const body = (await res.json().catch(() => null)) as { data?: { told?: number } } | null
      if (!res.ok) throw new Error(String(res.status))
      toast({ title: t("asked", { count: body?.data?.told ?? 0 }) })
    } catch {
      toast({ title: t("save_failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const edit = (f: (root: MaterialNode) => MaterialNode) => {
    if (!selRoot) return
    void saveRoot(selRoot, f(selRoot.root))
  }

  const row = (rootId: string, n: MaterialNode, depth: number) => (
    <li key={n.id}>
      <button
        type="button"
        onClick={() => setSel({ rootId, id: n.id })}
        className={cn("flex min-h-9 w-full items-center gap-2 rounded-md pe-2 text-start text-sm hover:bg-muted", DEPTH[depth] || "ps-12", sel?.id === n.id && "bg-module/10 font-semibold text-module", n.hidden && "text-muted-foreground line-through")}
      >
        {label(n, locale)}
        {n.hidden && <EyeOff size={12} aria-hidden="true" />}
      </button>
      {n.children.length > 0 && <ul>{n.children.map((c) => row(rootId, c, depth + 1))}</ul>}
    </li>
  )

  return (
    <div className="space-y-6" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[14rem] flex-1">
          <h1 className="text-2xl font-black text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={askSuppliers} disabled={!!busy} className="gap-2">
            {busy === "ask" ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />}
            {t("ask_suppliers")}
          </Button>
          <Button onClick={importShipped} disabled={!!busy} className="gap-2">
            {busy === "import" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {counts.roots ? t("reimport") : t("import")}
          </Button>
        </div>
      </div>

      {docs && !docs.length && <Callout tone="warn">{t("not_imported")}</Callout>}
      {docs && docs.length > 0 && <Callout tone="info">{t("status", { roots: counts.roots, nodes: counts.nodes })}</Callout>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Panel icon={FolderTree} title={t("tree")} count={counts.roots} bodyClassName="max-h-[70vh] overflow-y-auto p-2">
          {!docs ? (
            <p className="p-3 text-sm text-muted-foreground">{tm("loading")}</p>
          ) : !docs.length ? (
            <EmptyState icon={FolderTree} title={t("empty")} />
          ) : (
            <ul>
              {docs.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    aria-expanded={openRoot === d.id}
                    onClick={() => {
                      setOpenRoot(openRoot === d.id ? null : d.id)
                      setSel({ rootId: d.id, id: d.root.id })
                    }}
                    className={cn("flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-2 text-start text-sm font-bold hover:bg-muted", d.root.hidden && "text-muted-foreground line-through")}
                  >
                    {label(d.root, locale)}
                    <ChevronDown size={14} className={cn("transition-transform", openRoot === d.id && "rotate-180")} aria-hidden="true" />
                  </button>
                  {openRoot === d.id && <ul>{d.root.children.map((c) => row(d.id, c, 1))}</ul>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={selNode ? label(selNode, locale) : t("pick_node")}>
          {!selNode ? (
            <p className="text-sm text-muted-foreground">{t("pick_node_hint")}</p>
          ) : (
            <div className="space-y-5">
              <fieldset className="space-y-2">
                <legend className="text-xs font-semibold text-muted-foreground">{t("names")}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={draft.ar} onChange={(e) => setDraft((d) => ({ ...d, ar: e.target.value }))} aria-label={t("name_ar")} placeholder={t("name_ar")} dir="rtl" />
                  <Input value={draft.en} onChange={(e) => setDraft((d) => ({ ...d, en: e.target.value }))} aria-label={t("name_en")} placeholder={t("name_en")} dir="ltr" />
                </div>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy || !draft.ar.trim() || (draft.ar === selNode.ar && draft.en === selNode.en)} onClick={() => edit((r) => renameNode(r, selNode.id, draft))}>
                  <Save size={14} /> {t("save_names")}
                </Button>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-xs font-semibold text-muted-foreground">{tm("unit")}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {UNITS.map((u) => {
                    const on = selNode.units.some((x) => x.key === u.key)
                    return (
                      <Chip key={u.key} selected={on} disabled={!!busy} onClick={() => edit((r) => setUnits(r, selNode.id, on ? selNode.units.filter((x) => x.key !== u.key) : [...selNode.units, u]))}>
                        {label(u, locale)}
                      </Chip>
                    )
                  })}
                </div>
              </fieldset>

              {selNode.specs.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">{t("specs")}</p>
                  <ul className="space-y-1 text-sm">
                    {selNode.specs.map((s) => (
                      <li key={s.ar}>
                        <b>{label(shortSpecName(s), locale)}</b> <span className="text-muted-foreground">· {s.options.map((o) => label(o, locale)).join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
                <span>
                  <b className="block">{t("hide")}</b>
                  <span className="text-xs text-muted-foreground">{t("hide_hint")}</span>
                </span>
                <Switch checked={!!selNode.hidden} disabled={!!busy} onCheckedChange={(v) => edit((r) => setHidden(r, selNode.id, v))} />
              </label>

              {selNode.level < 3 && (
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold text-muted-foreground">{t("add_child", { level: selNode.level + 1 })}</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input value={child.ar} onChange={(e) => setChild((c) => ({ ...c, ar: e.target.value }))} aria-label={t("name_ar")} placeholder={t("name_ar")} dir="rtl" />
                    <Input value={child.en} onChange={(e) => setChild((c) => ({ ...c, en: e.target.value }))} aria-label={t("name_en")} placeholder={t("name_en")} dir="ltr" />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={!!busy || !child.ar.trim()}
                    onClick={() => {
                      edit((r) => addChild(r, selNode.id, child, newId()))
                      setChild({ ar: "", en: "" })
                    }}
                  >
                    <Plus size={14} /> {t("add")}
                  </Button>
                </fieldset>
              )}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={t("suggestions")} count={suggestions.length}>
        {!suggestions.length ? (
          <p className="text-sm text-muted-foreground">{t("no_suggestions")}</p>
        ) : (
          <ul className="divide-y">
            {suggestions.map((s) => (
              <li key={`${s.subId}:${s.name}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span>
                  <b dir="auto">{s.name}</b> <span className="text-xs text-muted-foreground">· {s.sub}</span>
                </span>
                <span className="text-xs text-muted-foreground">{t("mentions", { count: s.count, day: s.lastAt.slice(0, 10) })}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
