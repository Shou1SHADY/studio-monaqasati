/**
 * Supplier 1.0 — the world provider must SETTLE. `useResolvedProfile` hands back a new object on every render; a query
 * or an effect that keyed on it restarted on every render (the listener never delivered, the invitations request ran
 * thousands of times and every screen showed zeros). Re-rendering with a fresh profile object must leave the queries
 * and the request alone.
 */

import { act, render } from "@testing-library/react"
import { FreeWorldProvider, profileSignature, useFreeWorld } from "@/components/supplier-free/FreeWorldProvider"

const queries: unknown[][] = []

jest.mock("firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  doc: (_db: unknown, name: string, id: string) => ({ name, id }),
  query: (...parts: unknown[]) => ({ parts }),
  where: (...args: unknown[]) => ({ args }),
  deleteField: () => "DEL",
  serverTimestamp: () => "TS",
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
}))
jest.mock("@/firebase", () => {
  const { useMemo } = jest.requireActual("react")
  const user = { uid: "sup1", displayName: "S", email: "s@x.test", getIdToken: async () => "tok" }
  const firestore = {}
  return {
    useFirestore: () => firestore,
    useUser: () => ({ user, isUserLoading: false }),
    useMemoFirebase: (factory: () => unknown, deps: unknown[]) => useMemo(factory, deps),
    useCollection: (q: unknown) => {
      queries.push([q])
      return { data: [], isLoading: false, error: null }
    },
    useDoc: () => ({ data: null, isLoading: false, error: null }),
  }
})
jest.mock("@/hooks/useChunkedDocs", () => ({ useChunkedDocs: () => ({ data: [], ready: true }) }))
const stored: { certificates: string[] } = { certificates: [] }
jest.mock("@/hooks/useResolvedProfile", () => ({
  // a NEW object on every call, as the real hook returns
  useResolvedProfile: () => ({ profile: { name: "Sami", companyName: "Al Noor", phone: "0500000000", email: "s@x.test", city: "الرياض", specializations: ["حديد ومعادن"], coverageCities: ["الرياض"], isVerified: false, certificates: [...stored.certificates] }, organizationId: "sup1", isLoading: false }),
}))

const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
beforeEach(() => {
  queries.length = 0
  fetchMock.mockClear()
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
})

function Probe({ onValue }: { onValue: (v: ReturnType<typeof useFreeWorld>) => void }) {
  onValue(useFreeWorld())
  return null
}

describe("FreeWorldProvider", () => {
  it("asks for the invitations once and keeps its queries across re-renders", async () => {
    let latest: ReturnType<typeof useFreeWorld> | null = null
    const ui = (
      <FreeWorldProvider>
        <Probe onValue={(v) => (latest = v)} />
      </FreeWorldProvider>
    )
    const { rerender } = render(ui)
    for (let i = 0; i < 6; i++) await act(async () => rerender(ui))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const publicQueries = new Set(queries.map((q) => q[0]).filter((q) => JSON.stringify(q).includes("visibility")))
    expect(publicQueries.size).toBe(1)
    const allQueries = new Set(queries.map((q) => q[0]))
    expect(allQueries.size).toBe(new Set(queries.slice(0, 15).map((q) => q[0])).size) // one render: 11 queries + the 4 tree slots of useFieldRfqs (PUR-04)
    expect(latest).not.toBeNull()
    expect(latest!.ready).toBe(true)
    expect(latest!.profile?.orgId).toBe("sup1")
  })

  it("hands screens the profile as it is NOW: a list saved mid-session reaches `raw` (else the next save drops it)", async () => {
    stored.certificates = []
    let latest: ReturnType<typeof useFreeWorld> | null = null
    // a fresh element each time, so React renders the provider again (as a parent's re-render does)
    const ui = () => (
      <FreeWorldProvider>
        <Probe onValue={(v) => (latest = v)} />
      </FreeWorldProvider>
    )
    const { rerender } = render(ui())
    stored.certificates = ["A"]
    await act(async () => rerender(ui()))
    expect((latest!.profile?.raw as { certificates: string[] }).certificates).toEqual(["A"])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("signs Timestamps by their millis and never by identity", () => {
    const ts = (ms: number) => Object.assign(Object.create({ toMillis() { return (this as { ms: number }).ms } }), { ms })
    expect(profileSignature({ at: ts(5) })).toBe(profileSignature({ at: ts(5) }))
    expect(profileSignature({ at: ts(5) })).not.toBe(profileSignature({ at: ts(6) }))
  })
})
