/**
 * An in-memory Firestore for scenario tests — the subset of the web SDK the
 * write layers use, with the behaviours that make real bugs visible:
 *
 *   • transactions and batches commit atomically (a throw writes nothing);
 *   • a transaction refuses a read after its first write, as Firestore does;
 *   • `updateDoc` on a missing document fails;
 *   • `undefined`, nested arrays and class instances are rejected on write
 *     (the app does not enable `ignoreUndefinedProperties`);
 *   • dotted update paths, `{ merge: true }`, `increment`, `arrayUnion`,
 *     `arrayRemove`, `deleteField` and `serverTimestamp` are applied.
 *
 * Wire it with:
 *   jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/fake-firestore").firestoreModule)
 *
 * Stored documents are plain deep-cloned objects; `serverTimestamp()` stores
 * the (possibly faked) current time as an ISO string.
 */

type Plain = Record<string, unknown>

// ---------------------------------------------------------------------------
// Sentinels and values
// ---------------------------------------------------------------------------

type SentinelKind = "serverTimestamp" | "increment" | "arrayUnion" | "arrayRemove" | "deleteField"

export class FieldValueSentinel {
  constructor(
    readonly kind: SentinelKind,
    readonly operand: unknown = null
  ) {}
}

export class FakeTimestamp {
  constructor(
    readonly seconds: number,
    readonly nanoseconds: number
  ) {}
  static now(): FakeTimestamp {
    return FakeTimestamp.fromMillis(Date.now())
  }
  static fromDate(d: Date): FakeTimestamp {
    return FakeTimestamp.fromMillis(d.getTime())
  }
  static fromMillis(ms: number): FakeTimestamp {
    return new FakeTimestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6)
  }
  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6)
  }
  toDate(): Date {
    return new Date(this.toMillis())
  }
}

const DELETE = Symbol("delete")

export class FakeFirestoreError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "FirebaseError"
  }
}

const isPlainObject = (v: unknown): v is Plain => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function clone<T>(v: T): T {
  if (v instanceof FieldValueSentinel || v instanceof FakeTimestamp) return v
  if (Array.isArray(v)) return v.map((x) => clone(x)) as unknown as T
  if (isPlainObject(v)) {
    const out: Plain = {}
    for (const [k, x] of Object.entries(v)) out[k] = clone(x)
    return out as T
  }
  return v
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a instanceof FakeTimestamp && b instanceof FakeTimestamp) return a.toMillis() === b.toMillis()
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

/** Firestore's write-time validation (no ignoreUndefinedProperties). */
function validate(value: unknown, field: string, fn: string, inArray = false): void {
  const where = field ? ` (found in field ${field})` : ""
  if (value === undefined) throw new FakeFirestoreError("invalid-argument", `Function ${fn}() called with invalid data. Unsupported field value: undefined${where}`)
  if (value === null) return
  const t = typeof value
  if (t === "string" || t === "number" || t === "boolean") return
  if (t === "function" || t === "symbol" || t === "bigint") throw new FakeFirestoreError("invalid-argument", `Function ${fn}() called with invalid data. Unsupported field value: ${t}${where}`)
  if (value instanceof FieldValueSentinel) {
    if (inArray) throw new FakeFirestoreError("invalid-argument", `Function ${fn}() called with invalid data. ${value.kind}() is not currently supported inside arrays${where}`)
    return
  }
  if (value instanceof FakeTimestamp) return
  if (Array.isArray(value)) {
    value.forEach((x, i) => {
      if (Array.isArray(x)) throw new FakeFirestoreError("invalid-argument", `Function ${fn}() called with invalid data. Nested arrays are not supported${where}`)
      validate(x, `${field}[${i}]`, fn, true)
    })
    return
  }
  if (!isPlainObject(value)) {
    const name = (value as { constructor?: { name?: string } }).constructor?.name || "object"
    throw new FakeFirestoreError("invalid-argument", `Function ${fn}() called with invalid data. Unsupported field value: a custom ${name} object${where}`)
  }
  for (const [k, x] of Object.entries(value)) validate(x, field ? `${field}.${k}` : k, fn)
}

/** The stored value for a written leaf, given what was there before. */
function materialize(value: unknown, prev: unknown): unknown {
  if (value instanceof FieldValueSentinel) {
    switch (value.kind) {
      case "serverTimestamp":
        return new Date().toISOString()
      case "increment":
        return (typeof prev === "number" ? prev : 0) + Number(value.operand)
      case "arrayUnion": {
        const base = Array.isArray(prev) ? clone(prev) : []
        for (const x of value.operand as unknown[]) if (!base.some((y) => deepEqual(x, y))) base.push(clone(x))
        return base
      }
      case "arrayRemove": {
        const base = Array.isArray(prev) ? prev : []
        return clone(base.filter((y) => !(value.operand as unknown[]).some((x) => deepEqual(x, y))))
      }
      case "deleteField":
        return DELETE
    }
  }
  if (Array.isArray(value)) return value.map((x) => materialize(x, undefined))
  if (isPlainObject(value)) {
    const out: Plain = {}
    for (const [k, x] of Object.entries(value)) {
      const m = materialize(x, undefined)
      if (m !== DELETE) out[k] = m
    }
    return out
  }
  return value
}

function getPath(data: Plain, field: string): unknown {
  let node: unknown = data
  for (const seg of field.split(".")) {
    if (!isPlainObject(node)) return undefined
    node = node[seg]
  }
  return node
}

// ---------------------------------------------------------------------------
// The store and references
// ---------------------------------------------------------------------------

const docs = new Map<string, Plain>()
let autoSeq = 0

export interface FakeFirestoreInstance {
  readonly kind: "fake-firestore"
}
export const fakeFirestore: FakeFirestoreInstance = { kind: "fake-firestore" }

export interface FakeCollectionRef {
  readonly type: "collection"
  readonly path: string
  readonly id: string
  readonly firestore: FakeFirestoreInstance
}

export interface FakeDocRef {
  readonly type: "document"
  readonly path: string
  readonly id: string
  readonly firestore: FakeFirestoreInstance
  readonly parent: FakeCollectionRef
}

type WhereOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in" | "array-contains" | "array-contains-any"

interface WhereConstraint {
  readonly type: "where"
  readonly field: string
  readonly op: WhereOp
  readonly value: unknown
}
interface OrderByConstraint {
  readonly type: "orderBy"
  readonly field: string
  readonly direction: "asc" | "desc"
}
interface LimitConstraint {
  readonly type: "limit"
  readonly n: number
}
type Constraint = WhereConstraint | OrderByConstraint | LimitConstraint

export interface FakeQuery {
  readonly type: "query"
  readonly path: string
  readonly constraints: Constraint[]
  readonly firestore: FakeFirestoreInstance
}

const isRef = (v: unknown): v is FakeDocRef | FakeCollectionRef | FakeQuery =>
  !!v && typeof v === "object" && ((v as { type?: string }).type === "document" || (v as { type?: string }).type === "collection" || (v as { type?: string }).type === "query")

const splitSegments = (parts: string[]): string[] => parts.flatMap((p) => String(p).split("/")).filter((s) => s.length > 0)

function collRef(path: string): FakeCollectionRef {
  const segs = path.split("/")
  return { type: "collection", path, id: segs[segs.length - 1], firestore: fakeFirestore }
}

function docRef(path: string): FakeDocRef {
  const segs = path.split("/")
  return { type: "document", path, id: segs[segs.length - 1], firestore: fakeFirestore, parent: collRef(segs.slice(0, -1).join("/")) }
}

function nextAutoId(): string {
  autoSeq += 1
  return `auto${String(autoSeq).padStart(5, "0")}`
}

function collection(parent: unknown, ...paths: string[]): FakeCollectionRef {
  const base = isRef(parent) ? parent.path.split("/") : []
  const segs = [...base, ...splitSegments(paths)]
  if (segs.length % 2 !== 1) throw new FakeFirestoreError("invalid-argument", `Invalid collection reference: ${segs.join("/")} has ${segs.length} segments`)
  return collRef(segs.join("/"))
}

function doc(parent: unknown, ...paths: string[]): FakeDocRef {
  const base = isRef(parent) ? parent.path.split("/") : []
  let segs = [...base, ...splitSegments(paths)]
  if (isRef(parent) && parent.type === "collection" && paths.length === 0) segs = [...segs, nextAutoId()]
  if (!segs.length || segs.length % 2 !== 0) throw new FakeFirestoreError("invalid-argument", `Invalid document reference: ${segs.join("/")} has ${segs.length} segments`)
  return docRef(segs.join("/"))
}

// ---------------------------------------------------------------------------
// Snapshots and queries
// ---------------------------------------------------------------------------

export interface FakeDocSnapshot {
  readonly id: string
  readonly ref: FakeDocRef
  exists(): boolean
  data(): Plain | undefined
  get(field: string): unknown
}

function snapshotOf(ref: FakeDocRef): FakeDocSnapshot {
  const stored = docs.get(ref.path)
  const frozen = stored === undefined ? undefined : clone(stored)
  return {
    id: ref.id,
    ref,
    exists: () => frozen !== undefined,
    data: () => (frozen === undefined ? undefined : clone(frozen)),
    get: (field: string) => (frozen === undefined ? undefined : clone(getPath(frozen, field))),
  }
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b)
  if (a instanceof FakeTimestamp && b instanceof FakeTimestamp) return a.toMillis() - b.toMillis()
  return NaN
}

function matches(data: Plain, c: WhereConstraint): boolean {
  const v = getPath(data, c.field)
  switch (c.op) {
    case "==":
      return v !== undefined && deepEqual(v, c.value)
    case "!=":
      return v !== undefined && v !== null && !deepEqual(v, c.value)
    case "<":
      return compare(v, c.value) < 0
    case "<=":
      return compare(v, c.value) <= 0
    case ">":
      return compare(v, c.value) > 0
    case ">=":
      return compare(v, c.value) >= 0
    case "in":
      return v !== undefined && (c.value as unknown[]).some((x) => deepEqual(v, x))
    case "not-in":
      return v !== undefined && v !== null && !(c.value as unknown[]).some((x) => deepEqual(v, x))
    case "array-contains":
      return Array.isArray(v) && v.some((x) => deepEqual(x, c.value))
    case "array-contains-any":
      return Array.isArray(v) && v.some((x) => (c.value as unknown[]).some((y) => deepEqual(x, y)))
  }
}

function childrenOf(collectionPath: string): Array<[string, Plain]> {
  const depth = collectionPath.split("/").length + 1
  return Array.from(docs.entries())
    .filter(([p]) => p.startsWith(`${collectionPath}/`) && p.split("/").length === depth)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

function query(base: FakeCollectionRef | FakeQuery, ...constraints: Constraint[]): FakeQuery {
  const prior = base.type === "query" ? base.constraints : []
  return { type: "query", path: base.path, constraints: [...prior, ...constraints], firestore: fakeFirestore }
}

const where = (field: string, op: WhereOp, value: unknown): WhereConstraint => ({ type: "where", field, op, value })
const orderBy = (field: string, direction: "asc" | "desc" = "asc"): OrderByConstraint => ({ type: "orderBy", field, direction })
const limit = (n: number): LimitConstraint => ({ type: "limit", n })

export interface FakeQuerySnapshot {
  readonly docs: FakeDocSnapshot[]
  readonly empty: boolean
  readonly size: number
  forEach(fn: (d: FakeDocSnapshot) => void): void
}

async function getDoc(ref: FakeDocRef): Promise<FakeDocSnapshot> {
  return snapshotOf(ref)
}

async function getDocs(q: FakeCollectionRef | FakeQuery): Promise<FakeQuerySnapshot> {
  const constraints = q.type === "query" ? q.constraints : []
  let rows = childrenOf(q.path).filter(([, data]) => constraints.every((c) => c.type !== "where" || matches(data, c)))
  for (const c of constraints.filter((x): x is OrderByConstraint => x.type === "orderBy").reverse()) {
    rows = rows.slice().sort(([, a], [, b]) => {
      const r = compare(getPath(a, c.field), getPath(b, c.field)) || 0
      return c.direction === "desc" ? -r : r
    })
  }
  const lim = constraints.filter((x): x is LimitConstraint => x.type === "limit").pop()
  if (lim) rows = rows.slice(0, lim.n)
  const snaps = rows.map(([p]) => snapshotOf(docRef(p)))
  return { docs: snaps, empty: snaps.length === 0, size: snaps.length, forEach: (fn) => snaps.forEach(fn) }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

interface SetOptions {
  merge?: boolean
}

function mergeInto(target: Plain, data: Plain): void {
  for (const [k, v] of Object.entries(data)) {
    if (isPlainObject(v)) {
      const next = isPlainObject(target[k]) ? (target[k] as Plain) : {}
      mergeInto(next, v)
      target[k] = next
    } else {
      const m = materialize(v, target[k])
      if (m === DELETE) delete target[k]
      else target[k] = m
    }
  }
}

function applySet(path: string, data: Plain, options?: SetOptions): void {
  const prev = docs.get(path)
  if (options?.merge && prev) {
    const next = clone(prev)
    mergeInto(next, data)
    docs.set(path, next)
  } else {
    docs.set(path, materialize(data, undefined) as Plain)
  }
}

function applyUpdate(path: string, data: Plain): void {
  const prev = docs.get(path)
  if (!prev) throw new FakeFirestoreError("not-found", `No document to update: ${path}`)
  const next = clone(prev)
  for (const [k, v] of Object.entries(data)) {
    const segs = k.split(".")
    let node = next
    for (const s of segs.slice(0, -1)) {
      if (!isPlainObject(node[s])) node[s] = {}
      node = node[s] as Plain
    }
    const last = segs[segs.length - 1]
    const m = materialize(v, node[last])
    if (m === DELETE) delete node[last]
    else node[last] = m
  }
  docs.set(path, next)
}

function updateData(fn: string, fieldOrData: string | Plain, rest: unknown[]): Plain {
  if (typeof fieldOrData === "string") {
    const out: Plain = { [fieldOrData]: rest[0] }
    for (let i = 1; i + 1 < rest.length; i += 2) out[String(rest[i])] = rest[i + 1]
    return out
  }
  if (!isPlainObject(fieldOrData)) throw new FakeFirestoreError("invalid-argument", `Function ${fn}() called with invalid data`)
  return fieldOrData
}

function checkData(data: unknown, fn: string): Plain {
  if (!isPlainObject(data)) throw new FakeFirestoreError("invalid-argument", `Function ${fn}() called with invalid data. Data must be an object`)
  validate(data, "", fn)
  return clone(data)
}

/** Stage writes and apply them all or none. */
function commitAtomically(ops: Array<() => void>): void {
  const backup = new Map(docs)
  try {
    for (const op of ops) op()
  } catch (err) {
    docs.clear()
    backup.forEach((v, k) => docs.set(k, v))
    throw err
  }
}

async function setDoc(ref: FakeDocRef, data: Plain, options?: SetOptions): Promise<void> {
  const clean = checkData(data, "setDoc")
  applySet(ref.path, clean, options)
}

async function updateDoc(ref: FakeDocRef, fieldOrData: string | Plain, ...rest: unknown[]): Promise<void> {
  const clean = checkData(updateData("updateDoc", fieldOrData, rest), "updateDoc")
  applyUpdate(ref.path, clean)
}

async function deleteDoc(ref: FakeDocRef): Promise<void> {
  docs.delete(ref.path)
}

async function addDoc(coll: FakeCollectionRef, data: Plain): Promise<FakeDocRef> {
  const ref = doc(coll)
  await setDoc(ref, data)
  return ref
}

export interface FakeWriteBatch {
  set(ref: FakeDocRef, data: Plain, options?: SetOptions): FakeWriteBatch
  update(ref: FakeDocRef, fieldOrData: string | Plain, ...rest: unknown[]): FakeWriteBatch
  delete(ref: FakeDocRef): FakeWriteBatch
  commit(): Promise<void>
}

function writeBatch(): FakeWriteBatch {
  const ops: Array<() => void> = []
  let committed = false
  const guard = () => {
    if (committed) throw new FakeFirestoreError("failed-precondition", "A write batch can no longer be used after commit() has been called.")
  }
  const batch: FakeWriteBatch = {
    set(ref, data, options) {
      guard()
      const clean = checkData(data, "WriteBatch.set")
      ops.push(() => applySet(ref.path, clean, options))
      return batch
    },
    update(ref, fieldOrData, ...rest) {
      guard()
      const clean = checkData(updateData("WriteBatch.update", fieldOrData, rest), "WriteBatch.update")
      ops.push(() => applyUpdate(ref.path, clean))
      return batch
    },
    delete(ref) {
      guard()
      ops.push(() => docs.delete(ref.path))
      return batch
    },
    async commit() {
      guard()
      committed = true
      commitAtomically(ops)
    },
  }
  return batch
}

export interface FakeTransaction {
  get(ref: FakeDocRef): Promise<FakeDocSnapshot>
  set(ref: FakeDocRef, data: Plain, options?: SetOptions): FakeTransaction
  update(ref: FakeDocRef, fieldOrData: string | Plain, ...rest: unknown[]): FakeTransaction
  delete(ref: FakeDocRef): FakeTransaction
}

async function runTransaction<T>(_firestore: unknown, updateFunction: (tx: FakeTransaction) => Promise<T>): Promise<T> {
  const ops: Array<() => void> = []
  const tx: FakeTransaction = {
    async get(ref) {
      if (ops.length > 0) throw new FakeFirestoreError("invalid-argument", "Firestore transactions require all reads to be executed before all writes.")
      return snapshotOf(ref)
    },
    set(ref, data, options) {
      const clean = checkData(data, "Transaction.set")
      ops.push(() => applySet(ref.path, clean, options))
      return tx
    },
    update(ref, fieldOrData, ...rest) {
      const clean = checkData(updateData("Transaction.update", fieldOrData, rest), "Transaction.update")
      ops.push(() => applyUpdate(ref.path, clean))
      return tx
    },
    delete(ref) {
      ops.push(() => docs.delete(ref.path))
      return tx
    },
  }
  const result = await updateFunction(tx)
  commitAtomically(ops)
  return result
}

// ---------------------------------------------------------------------------
// The module surface and test helpers
// ---------------------------------------------------------------------------

export const firestoreModule = {
  getFirestore: () => fakeFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch: (_firestore?: unknown) => writeBatch(),
  runTransaction,
  serverTimestamp: () => new FieldValueSentinel("serverTimestamp"),
  increment: (n: number) => new FieldValueSentinel("increment", n),
  arrayUnion: (...values: unknown[]) => new FieldValueSentinel("arrayUnion", values),
  arrayRemove: (...values: unknown[]) => new FieldValueSentinel("arrayRemove", values),
  deleteField: () => new FieldValueSentinel("deleteField"),
  documentId: () => "__name__",
  Timestamp: FakeTimestamp,
}

export function resetFakeDb(): void {
  docs.clear()
  autoSeq = 0
}

/** Write a document directly, as another module or an import would. */
export function seed(path: string, data: Plain): void {
  const segs = splitSegments([path])
  if (!segs.length || segs.length % 2 !== 0) throw new Error(`seed: ${path} is not a document path`)
  applySet(segs.join("/"), checkData(data, "seed"))
}

export function readDoc<T>(path: string): (T & { id: string }) | null {
  const stored = docs.get(path)
  if (!stored) return null
  const segs = path.split("/")
  return { ...(clone(stored) as T), id: segs[segs.length - 1] }
}

export function listCollection<T>(path: string): Array<T & { id: string }> {
  return childrenOf(path).map(([p, data]) => ({ ...(clone(data) as T), id: p.split("/").pop() as string }))
}

/** Every document in any collection with this id (e.g. all `inventoryItems`). */
export function listCollectionGroup<T>(collectionId: string): Array<T & { id: string; path: string }> {
  return Array.from(docs.entries())
    .filter(([p]) => {
      const segs = p.split("/")
      return segs.length >= 2 && segs[segs.length - 2] === collectionId
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([p, data]) => ({ ...(clone(data) as T), id: p.split("/").pop() as string, path: p }))
}

/** A stable dump of the whole store — compare before/after to prove a refused write wrote nothing. */
export function dumpDb(): string {
  const sorted = Array.from(docs.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify(sorted)
}
