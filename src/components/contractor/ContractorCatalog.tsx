"use client"

import { useState, useMemo } from "react"
import { useRouter } from "@/i18n/routing"
import { Link } from "@/i18n/routing"
import { useTranslations, useLocale } from 'next-intl'
import { useFirestore, useUser, useDoc, useMemoFirebase, useCollection } from "@/firebase"
import { doc, collection, query, where } from "firebase/firestore"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { motion, AnimatePresence } from "framer-motion"
import {
  Search, ShoppingCart, X, Package, Zap, Loader2,
  Wrench, Factory, Building2, Layers, DoorOpen, Shield,
  Palette, Grid3x3, Droplets, FlameKindling
} from "lucide-react"
import { cn } from "@/lib/utils"
import { displayCategory } from "@/lib/constants"
import type { CatalogItem } from "@/lib/catalog-utils"

// ── Category visual config ────────────────────────────────────────────────────

type Palette = { bg: string; text: string; border: string; icon: React.ElementType }

const CATEGORY_MAP: Record<string, Palette> = {
  'حديد ومعادن':              { bg: 'bg-slate-100',    text: 'text-slate-600',   border: 'border-slate-200',   icon: Wrench },
  'أسمنت وخرسانة':            { bg: 'bg-stone-100',    text: 'text-stone-600',   border: 'border-stone-200',   icon: Factory },
  'طوب وبلوك':                { bg: 'bg-amber-100',    text: 'text-amber-700',   border: 'border-amber-200',   icon: Building2 },
  'أرضيات وتشطيبات':          { bg: 'bg-teal-50',      text: 'text-teal-700',    border: 'border-teal-200',    icon: Layers },
  'أبواب ونوافذ':             { bg: 'bg-blue-50',      text: 'text-blue-700',    border: 'border-blue-200',    icon: DoorOpen },
  'عزل ومواد مانعة للتسرب':  { bg: 'bg-cyan-50',      text: 'text-cyan-700',    border: 'border-cyan-200',    icon: Shield },
  'كهرباء وإنارة':            { bg: 'bg-yellow-50',    text: 'text-yellow-700',  border: 'border-yellow-200',  icon: Zap },
  'سباكة وصرف صحي':          { bg: 'bg-sky-50',       text: 'text-sky-700',     border: 'border-sky-200',     icon: Droplets },
  'دهانات وألوان':            { bg: 'bg-rose-50',      text: 'text-rose-700',    border: 'border-rose-200',    icon: Palette },
  'ألواح جبسية وأسقف مستعارة': { bg: 'bg-violet-50', text: 'text-violet-700',  border: 'border-violet-200',  icon: Grid3x3 },
}

const FALLBACK_PALETTES: Palette[] = [
  { bg: 'bg-accent/10',    text: 'text-accent',    border: 'border-accent/20',    icon: Package },
  { bg: 'bg-success/10',   text: 'text-success',   border: 'border-success/20',   icon: Package },
  { bg: 'bg-orange-50',    text: 'text-orange-700', border: 'border-orange-200',  icon: FlameKindling },
  { bg: 'bg-purple-50',    text: 'text-purple-700', border: 'border-purple-200',  icon: Package },
]

function getCategoryStyle(category: string): Palette {
  if (CATEGORY_MAP[category]) return CATEGORY_MAP[category]
  const hash = [...category].reduce((a, c) => a + c.charCodeAt(0), 0)
  return FALLBACK_PALETTES[hash % FALLBACK_PALETTES.length]
}

// ── CatalogItemCard ────────────────────────────────────────────────────────────

function CatalogItemCard({
  item,
  selected,
  onToggle,
  locale,
}: {
  item: CatalogItem
  selected: boolean
  onToggle: () => void
  locale: string
}) {
  const t = useTranslations("Portal.Contractor")
  const style = getCategoryStyle(item.category)
  const Icon = style.icon

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -3, transition: { duration: 0.15 } }}
      onClick={onToggle}
      role="checkbox"
      aria-checked={selected}
      tabIndex={0}
      onKeyDown={e => (e.key === ' ' || e.key === 'Enter') && onToggle()}
      className={cn(
        "relative p-5 rounded-2xl border-2 cursor-pointer transition-all duration-200 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
        selected
          ? "border-accent bg-accent/5 shadow-lg shadow-accent/10"
          : "border-border bg-card hover:border-accent/40 hover:shadow-md"
      )}
    >
      {/* Checkbox */}
      <div className={cn(
        "absolute top-3 flex items-center justify-center h-5 w-5 rounded-full border-2 transition-all duration-200",
        locale === 'ar' ? 'right-3' : 'left-3',
        selected ? "border-accent bg-accent" : "border-muted-foreground/30 bg-background"
      )}>
        {selected && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="h-2.5 w-2.5 rounded-full bg-white"
          />
        )}
      </div>

      {/* Usage count */}
      <div className={cn(
        "absolute top-3 px-2 py-0.5 rounded-full text-[11px] font-bold border",
        locale === 'ar' ? 'left-3' : 'right-3',
        style.bg, style.text, style.border
      )}>
        {t('catalog_usage_times', { count: item.usageCount })}
      </div>

      {/* Category icon */}
      <div className={cn("h-11 w-11 rounded-xl flex items-center justify-center mt-6 mb-3", style.bg)}>
        <Icon size={20} className={style.text} />
      </div>

      {/* Name */}
      <h3 className="font-bold text-foreground text-sm leading-snug mb-1 line-clamp-2">
        {item.name}
      </h3>

      {/* Category · unit */}
      <p className="text-xs text-muted-foreground mb-3">
        {displayCategory(item.category, locale)} · {item.unit}
      </p>

      {/* Last quantity chip */}
      <div className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg",
        style.bg, style.text
      )}>
        {t('catalog_last_qty', { qty: item.lastQuantity, unit: item.unit })}
      </div>
    </motion.div>
  )
}

// ── ContractorCatalog ─────────────────────────────────────────────────────────

export function ContractorCatalog() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const router = useRouter()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  const [search, setSearch] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile, isLoading: isProfileLoading } = useDoc(userDocRef)

  const catalogQuery = useMemoFirebase(() => {
    if (!firestore || !profile || !user) return null
    const orgId = (profile as Record<string, string>).organizationId || user.uid
    return query(
      collection(firestore, "contractorCatalog"),
      where("organizationId", "==", orgId)
    )
  }, [firestore, profile, user])

  const { data: rawItems, isLoading: isCatalogLoading } = useCollection<CatalogItem>(catalogQuery)

  const items = useMemo<CatalogItem[]>(() => {
    if (!rawItems) return []
    return [...rawItems].sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
  }, [rawItems])

  const categories = useMemo(() => [...new Set(items.map(i => i.category))].sort(), [items])

  const filtered = useMemo(() => items.filter(item => {
    if (selectedCategory && item.category !== selectedCategory) return false
    if (!search) return true
    const q = search.toLowerCase()
    return item.name.includes(search) || item.category.includes(search) || item.subCategory.includes(search) || item.name.toLowerCase().includes(q)
  }), [items, selectedCategory, search])

  const toggleItem = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreateRfq = () => {
    router.push(`/contractor/rfqs/new?catalog=${[...selectedIds].join(",")}`)
  }

  const isLoading = isUserLoading || isProfileLoading || isCatalogLoading

  return (
    <PortalLayout>
      <div className={cn("max-w-6xl mx-auto py-8 pb-32", locale === 'ar' ? 'text-right' : 'text-left')}>

        {/* Header */}
        <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">
              {t('catalog_page_title')}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">{t('catalog_page_desc')}</p>
          </div>
          <Link href="/contractor/rfqs/new">
            <Button variant="outline" className="gap-2 rounded-xl border-border">
              <Zap size={16} />
              {t('catalog_create_rfq')}
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center h-[50vh]">
            <Loader2 className="animate-spin text-primary" size={32} />
          </div>
        ) : items.length === 0 ? (
          // Empty state
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-24 text-center space-y-5"
          >
            <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center shadow-inner">
              <ShoppingCart size={36} className="text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground mb-2">{t('catalog_empty_title')}</h2>
              <p className="text-muted-foreground max-w-xs text-sm leading-relaxed">
                {t('catalog_empty_desc')}
              </p>
            </div>
            <Link href="/contractor/rfqs/new">
              <Button className="gap-2 rounded-xl shadow-md shadow-primary/20 mt-2">
                <Zap size={16} />
                {t('catalog_empty_cta')}
              </Button>
            </Link>
          </motion.div>
        ) : (
          <>
            {/* Search bar */}
            <div className="relative mb-5">
              <Search
                size={16}
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none",
                  locale === 'ar' ? 'right-3.5' : 'left-3.5'
                )}
              />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('catalog_search_placeholder')}
                className={cn(
                  "h-11 rounded-xl border-border bg-card max-w-sm",
                  locale === 'ar' ? 'pr-10' : 'pl-10'
                )}
              />
            </div>

            {/* Category chips */}
            <div className="flex flex-wrap gap-2 mb-5">
              <button
                onClick={() => setSelectedCategory(null)}
                className={cn(
                  "px-4 py-1.5 rounded-full text-sm font-semibold transition-all",
                  !selectedCategory
                    ? "bg-primary text-white shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {t('catalog_filter_all')} ({items.length})
              </button>
              {categories.map(cat => {
                const style = getCategoryStyle(cat)
                const count = items.filter(i => i.category === cat).length
                const isActive = selectedCategory === cat
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(isActive ? null : cat)}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-sm font-semibold transition-all border",
                      isActive
                        ? cn(style.bg, style.text, style.border)
                        : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                    )}
                  >
                    {displayCategory(cat, locale)} ({count})
                  </button>
                )
              })}
            </div>

            {/* Hint */}
            {selectedIds.size === 0 && (
              <p className="text-xs text-muted-foreground mb-4 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent inline-block shrink-0" />
                {t('catalog_select_hint')}
              </p>
            )}

            {/* Grid */}
            <motion.div layout className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              <AnimatePresence mode="popLayout">
                {filtered.map(item => (
                  <CatalogItemCard
                    key={item.id}
                    item={item}
                    selected={selectedIds.has(item.id)}
                    onToggle={() => toggleItem(item.id)}
                    locale={locale}
                  />
                ))}
              </AnimatePresence>
            </motion.div>

            {filtered.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <p className="font-semibold text-sm">{t('catalog_no_results')}</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating action bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed bottom-6 inset-x-0 flex justify-center z-50 pointer-events-none"
          >
            <div className="pointer-events-auto flex items-center gap-3 bg-primary text-white px-5 py-3.5 rounded-2xl shadow-2xl shadow-primary/40 border border-white/10 backdrop-blur-sm">
              <button
                onClick={() => setSelectedIds(new Set())}
                aria-label={t('catalog_deselect')}
                className="h-7 w-7 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors shrink-0"
              >
                <X size={13} />
              </button>
              <span className="text-sm font-semibold whitespace-nowrap">
                {selectedIds.size} {t('catalog_items_selected')}
              </span>
              <Button
                onClick={handleCreateRfq}
                className="bg-accent hover:bg-accent/90 text-primary font-bold rounded-xl h-9 px-5 text-sm shadow-lg shadow-accent/30 gap-2"
              >
                <ShoppingCart size={14} />
                {t('catalog_create_rfq_n', { count: selectedIds.size })}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </PortalLayout>
  )
}
