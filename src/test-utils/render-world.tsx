/**
 * Render harness for screen tests: a screen mounted over the in-memory
 * Firestore (fake-firestore) with the real message files, as a signed-in user.
 * The data hooks run for real — `@/firebase`'s useCollection/useDoc evaluate
 * their query against the fake store on every render (stable identity while
 * the result is unchanged), so usePermissions, usePmAccess, useSupplyWorld,
 * useProcurementWorld… read what the test seeded.
 *
 * Wire it with (jest.mock factories may only reach required modules):
 *   jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
 *   jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
 *   jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
 *   jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
 *   jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
 *
 * A missing message renders as `MISSING:<ns>.<key>` and is recorded in
 * `missingKeys`; a missing ICU value renders as `MISSING_VAR:<name>`.
 */

import fs from "fs"
import path from "path"
import React, { useMemo, useRef, type ReactNode } from "react"
import { fakeFirestore, firestoreModule as baseFirestore, listCollection, listCollectionGroup, readDoc } from "@/test-utils/fake-firestore"

type Plain = Record<string, unknown>

// ---------------------------------------------------------------------------
// The signed-in user and the locale
// ---------------------------------------------------------------------------

const state: { uid: string | null; locale: "ar" | "en"; pathname: string; search: string } = { uid: null, locale: "ar", pathname: "/", search: "" }
export const setSignedIn = (uid: string | null) => void (state.uid = uid)
export const setLocale = (locale: "ar" | "en") => void (state.locale = locale)
export const setPathname = (pathname: string, search = "") => {
  state.pathname = pathname
  state.search = search
}

// ---------------------------------------------------------------------------
// firebase/firestore: the fake, plus what the screens also import
// ---------------------------------------------------------------------------

type Ref = { type: "collection" | "document" | "query" | "group"; path: string; id?: string; constraints?: Array<{ type: string; field?: string; op?: string; value?: unknown; direction?: string; n?: number }> }

/** Every collection query a screen ran (useCollection, onSnapshot, getDocs) — for tests that check a role only
 * asks what the rules let it ask (a list the rules cannot prove is refused WHOLE). Cleared by the test. */
export const queriesRun: Ref[] = []
const noteQuery = (ref: Ref | null | undefined) => void (ref && ref.type !== "document" && queriesRun.push(ref))

const getPath = (data: Plain, field: string): unknown => field.split(".").reduce<unknown>((n, p) => (n && typeof n === "object" ? (n as Plain)[p] : undefined), data)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const cmp = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? a - b : typeof a === "string" && typeof b === "string" ? (a < b ? -1 : a > b ? 1 : 0) : NaN)

function whereOk(data: Plain, c: { field?: string; op?: string; value?: unknown }): boolean {
  const v = c.field === "__name__" ? data.id : getPath(data, c.field as string)
  switch (c.op) {
    case "==":
      return v !== undefined && same(v, c.value)
    case "!=":
      return v !== undefined && v !== null && !same(v, c.value)
    case "<":
      return cmp(v, c.value) < 0
    case "<=":
      return cmp(v, c.value) <= 0
    case ">":
      return cmp(v, c.value) > 0
    case ">=":
      return cmp(v, c.value) >= 0
    case "in":
      return v !== undefined && (c.value as unknown[]).some((x) => same(v, x))
    case "not-in":
      return v !== undefined && v !== null && !(c.value as unknown[]).some((x) => same(v, x))
    case "array-contains":
      return Array.isArray(v) && v.some((x) => same(x, c.value))
    case "array-contains-any":
      return Array.isArray(v) && v.some((x) => (c.value as unknown[]).some((y) => same(x, y)))
    default:
      return true
  }
}

export function evalQuery(ref: Ref): Array<Plain & { id: string }> {
  let rows: Array<Plain & { id: string }> = ref.type === "group" ? listCollectionGroup<Plain>(ref.id as string) : listCollection<Plain>(ref.path)
  const cs = ref.constraints ?? []
  rows = rows.filter((r) => cs.every((c) => c.type !== "where" || whereOk(r, c)))
  for (const c of cs.filter((x) => x.type === "orderBy").reverse()) {
    rows = rows.slice().sort((a, b) => {
      const r = cmp(getPath(a, c.field as string), getPath(b, c.field as string)) || 0
      return c.direction === "desc" ? -r : r
    })
  }
  const lim = cs.filter((x) => x.type === "limit").pop()
  return lim ? rows.slice(0, lim.n) : rows
}

const snapDoc = (p: string) => {
  const data = readDoc<Plain>(p)
  const id = p.split("/").pop() as string
  return { id, ref: { type: "document", path: p, id }, exists: () => data !== null, data: () => (data ? (({ id: _i, ...rest }) => rest)(data) : undefined), get: (f: string) => (data ? getPath(data, f) : undefined) }
}

export const firestoreMock = {
  ...baseFirestore,
  collectionGroup: (_db: unknown, id: string): Ref => ({ type: "group", path: `**/${id}`, id, constraints: [] }),
  query: (base: Ref, ...constraints: NonNullable<Ref["constraints"]>): Ref => ({ ...base, type: base.type === "group" ? "group" : "query", constraints: [...(base.constraints ?? []), ...constraints] }),
  getDocs: async (q: Ref) => {
    noteQuery(q)
    if (q.type !== "group") return baseFirestore.getDocs(q as Parameters<typeof baseFirestore.getDocs>[0])
    const docs = evalQuery(q).map((r) => ({ id: r.id, exists: () => true, data: () => r, get: (f: string) => getPath(r, f), ref: { id: r.id } }))
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn: (d: unknown) => void) => docs.forEach(fn) }
  },
  getCountFromServer: async (q: Ref) => ({ data: () => ({ count: evalQuery(q).length }) }),
  startAfter: () => ({ type: "startAfter" }),
  onSnapshot: (ref: Ref, next: (snap: unknown) => void) => {
    noteQuery(ref)
    if (ref.type === "document") next(snapDoc(ref.path))
    else {
      const docs = evalQuery(ref).map((r) => snapDoc(`${ref.type === "group" ? "" : `${ref.path}/`}${r.id}`))
      next({ docs, empty: docs.length === 0, size: docs.length, forEach: (fn: (d: unknown) => void) => docs.forEach(fn) })
    }
    return () => {}
  },
  Timestamp: baseFirestore.Timestamp,
}

// ---------------------------------------------------------------------------
// @/firebase: hooks over the fake store
// ---------------------------------------------------------------------------

function useStable<T>(value: T): T {
  const box = useRef<{ json: string; value: T } | null>(null)
  const json = JSON.stringify(value)
  if (!box.current || box.current.json !== json) box.current = { json, value }
  return box.current.value
}

function useCollection(ref: Ref | null | undefined) {
  noteQuery(ref)
  const data = ref ? evalQuery(ref) : null
  return { data: useStable(data), isLoading: false, error: null }
}

function useDoc(ref: Ref | null | undefined) {
  const data = ref ? readDoc<Plain>(ref.path) : null
  return { data: useStable(data), isLoading: false, error: null }
}

const fakeUser = (uid: string) => ({ uid, email: `${uid}@test.sa`, displayName: uid })

function useUser() {
  const uid = state.uid
  const user = useMemo(() => (uid ? fakeUser(uid) : null), [uid])
  return { user, isUserLoading: false, userError: null }
}

export const firebaseMock = {
  useFirestore: () => fakeFirestore,
  useFirebase: () => ({ firestore: fakeFirestore, auth: { currentUser: state.uid ? fakeUser(state.uid) : null }, storage: {}, firebaseApp: {}, user: state.uid ? fakeUser(state.uid) : null, isUserLoading: false, userError: null }),
  useAuth: () => ({ currentUser: state.uid ? fakeUser(state.uid) : null }),
  useStorage: () => ({}),
  useFirebaseApp: () => ({}),
  useMemoFirebase: <T,>(factory: () => T, deps: React.DependencyList): T => useMemo(factory, deps),
  useUser,
  useCollection,
  useDoc,
  useCollectionPaginated: (ref: Ref | null) => ({ data: ref ? evalQuery(ref) : null, isLoading: false, error: null, hasMore: false, loadMore: () => {}, isLoadingMore: false }),
  errorEmitter: { on: () => {}, off: () => {}, emit: () => {} },
  FirestorePermissionError: class extends Error {},
  setDocumentNonBlocking: () => {},
  addDocumentNonBlocking: () => Promise.resolve(),
  updateDocumentNonBlocking: () => {},
  deleteDocumentNonBlocking: () => {},
}

// ---------------------------------------------------------------------------
// next-intl over the real message files
// ---------------------------------------------------------------------------

export const missingKeys = new Set<string>()
const messageCache: Record<string, Plain> = {}
function overlay(target: Plain, source: Plain) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== "object") target[k] = {}
      overlay(target[k] as Plain, v as Plain)
    } else if (target[k] === undefined) target[k] = v
  }
}

/** The merged message files; while a fragment is still unmerged, set
 * I18N_FRAGMENTS=<dir of *.ar.json/*.en.json> to overlay it. */
export function messages(locale: string): Plain {
  if (messageCache[locale]) return messageCache[locale]
  const base = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8")) as Plain
  const dir = process.env.I18N_FRAGMENTS
  if (dir && fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(`.${locale}.json`)).sort()) overlay(base, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Plain)
  return (messageCache[locale] = base)
}

function branches(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  while (i < src.length) {
    const open = src.indexOf("{", i)
    if (open < 0) break
    const key = src.slice(i, open).trim()
    let depth = 0
    let j = open
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++
      else if (src[j] === "}" && --depth === 0) break
    }
    out[key] = src.slice(open + 1, j)
    i = j + 1
  }
  return out
}

function format(message: string, vars: Plain, locale: string): string {
  let out = ""
  let i = 0
  while (i < message.length) {
    if (message[i] === "'" && message[i + 1] === "'") {
      out += "'"
      i += 2
      continue
    }
    if (message[i] !== "{") {
      out += message[i++]
      continue
    }
    let depth = 0
    let j = i
    for (; j < message.length; j++) {
      if (message[j] === "{") depth++
      else if (message[j] === "}" && --depth === 0) break
    }
    const body = message.slice(i + 1, j)
    const plural = /^\s*(\w+)\s*,\s*(plural|selectordinal)\s*,([\s\S]*)$/.exec(body)
    const select = /^\s*(\w+)\s*,\s*select\s*,([\s\S]*)$/.exec(body)
    const typed = /^\s*(\w+)\s*,\s*(number|date|time)\b/.exec(body)
    const name = plural ? plural[1] : select ? select[1] : typed ? typed[1] : body.trim()
    if (!(name in vars)) out += `MISSING_VAR:${name}`
    else if (plural) {
      const n = Number(vars[name])
      const b = branches(plural[3].replace(/^\s*offset:\d+/, ""))
      const chosen = b[`=${n}`] ?? b[new Intl.PluralRules(locale).select(n)] ?? b.other ?? ""
      out += format(chosen.replace(/#/g, String(n)), vars, locale)
    } else if (select) {
      const b = branches(select[2])
      out += format(b[String(vars[name])] ?? b.other ?? "", vars, locale)
    } else out += String(vars[name])
    i = j + 1
  }
  return out
}

function lookup(namespace: string | undefined, key: string): unknown {
  const parts = [...(namespace ? namespace.split(".") : []), ...key.split(".")]
  return parts.reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Plain)[part] : undefined), messages(state.locale))
}

function translator(namespace?: string) {
  const miss = (key: string) => {
    const full = `${namespace ? `${namespace}.` : ""}${key}`
    missingKeys.add(full)
    return `MISSING:${full}`
  }
  const t = (key: string, vars?: Plain) => {
    const raw = lookup(namespace, key)
    if (typeof raw !== "string") return miss(key)
    const plain: Plain = {}
    for (const [k, v] of Object.entries(vars ?? {})) plain[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v
    return format(raw, plain, state.locale)
  }
  t.has = (key: string) => typeof lookup(namespace, key) === "string"
  t.raw = (key: string) => lookup(namespace, key) ?? miss(key)
  t.rich = (key: string, vars?: Record<string, unknown>) => {
    const tags: Record<string, (chunks: ReactNode) => ReactNode> = {}
    const values: Plain = {}
    for (const [k, v] of Object.entries(vars ?? {})) {
      if (typeof v === "function") tags[k] = v as (chunks: ReactNode) => ReactNode
      else values[k] = v
    }
    const text = t(key, values)
    const parts: ReactNode[] = []
    let rest = text
    const re = /<(\w+)>([\s\S]*?)<\/\1>/
    let m: RegExpExecArray | null
    let n = 0
    while ((m = re.exec(rest))) {
      parts.push(rest.slice(0, m.index))
      const fn = tags[m[1]]
      parts.push(React.createElement(React.Fragment, { key: n++ }, fn ? fn(m[2]) : m[2]))
      rest = rest.slice(m.index + m[0].length)
    }
    parts.push(rest)
    return parts
  }
  t.markup = (key: string, vars?: Plain) => t(key, vars)
  return t
}

export const intlMock = {
  useLocale: () => state.locale,
  useTranslations: (namespace?: string) => translator(namespace),
  useFormatter: () => ({ number: (n: number) => String(n), dateTime: (d: Date) => d.toISOString(), relativeTime: (d: Date) => d.toISOString() }),
  useNow: () => new Date(),
  useTimeZone: () => "Asia/Riyadh",
  useMessages: () => messages(state.locale),
  NextIntlClientProvider: ({ children }: { children: ReactNode }) => children,
}

// ---------------------------------------------------------------------------
// Icons, routing, navigation
// ---------------------------------------------------------------------------

export const lucideMock = new Proxy(
  {},
  {
    get: (_t, name) =>
      name === "__esModule"
        ? false
        : React.forwardRef<SVGSVGElement, Record<string, unknown>>(function Icon(props, ref) {
            return React.createElement("svg", { ref, "data-icon": String(name), "aria-hidden": props["aria-hidden"] ?? true, className: props.className as string | undefined })
          }),
  }
)

export const pushed: string[] = []
const router = { push: (h: string) => void pushed.push(h), replace: (h: string) => void pushed.push(h), back: () => {}, prefetch: () => {}, refresh: () => {} }

export const routingMock = {
  Link: React.forwardRef<HTMLAnchorElement, { href: string | { pathname: string }; children?: ReactNode; className?: string; onClick?: () => void; "aria-label"?: string; title?: string }>(function Link({ href, children, ...rest }, ref) {
    return React.createElement("a", { ref, href: typeof href === "string" ? href : href.pathname, ...rest }, children)
  }),
  usePathname: () => state.pathname,
  useRouter: () => router,
  redirect: () => {},
  getPathname: ({ href }: { href: string }) => href,
  routing: { locales: ["ar", "en"], defaultLocale: "ar" },
}

export const navigationMock = {
  useRouter: () => router,
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
  useParams: () => ({}),
  redirect: () => {},
  notFound: () => {},
}

/** jsdom lacks these; Radix and charts ask for them. */
export function installDomShims(): void {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g.ResizeObserver)
    g.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  if (!g.IntersectionObserver)
    g.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
  if (typeof window !== "undefined") {
    if (!window.matchMedia) window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
    if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
    if (!window.print) window.print = () => {}
  }
}

/** `@/ai/genkit` without Google's plugin (its ESM dependencies do not load under Jest). */
export const aiMock = {
  ai: new Proxy({}, { get: () => () => () => Promise.resolve(null) }),
}

/** The portal frame without its chrome: only the providers the screens rely on. */
export const portalLayoutMock = {
  PortalLayout: function PortalLayout({ children }: { children: ReactNode }) {
    const { TooltipProvider } = jest.requireActual<typeof import("@/components/ui/tooltip")>("@/components/ui/tooltip")
    return React.createElement(TooltipProvider, null, children)
  },
}
