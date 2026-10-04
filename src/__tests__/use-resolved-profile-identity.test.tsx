/**
 * useResolvedProfile and the company's sensitive identity (DEV-60): an owner's
 * profile is topped up from companyIdentity/{orgId}, the old profile fields
 * still win while they exist, a team member never reads the identity document,
 * and nothing is handed out half-merged.
 */
import { renderHook } from "@testing-library/react"

type DocState = { data: Record<string, unknown> | null; isLoading: boolean }
const docs: Record<string, DocState> = {}
const subscribed: string[] = []

jest.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
}))
jest.mock("@/firebase", () => ({
  useFirestore: () => ({}),
  useMemoFirebase: (factory: () => unknown) => factory(),
  useDoc: (ref: { path: string } | null) => {
    if (!ref) return { data: null, isLoading: false, error: null }
    subscribed.push(ref.path)
    const state = docs[ref.path] ?? { data: null, isLoading: false }
    return { data: state.data ? { id: ref.path.split("/").pop(), ...state.data } : null, isLoading: state.isLoading, error: null }
  },
}))

import { useResolvedProfile } from "@/hooks/useResolvedProfile"

const set = (path: string, data: Record<string, unknown> | null, isLoading = false) => {
  docs[path] = { data, isLoading }
}

beforeEach(() => {
  for (const k of Object.keys(docs)) delete docs[k]
  subscribed.length = 0
})

describe("the owner's profile", () => {
  it("is topped up from the identity document when the old fields are empty", () => {
    set("users/u1", { organizationId: "u1", organizationRole: "owner", name: "Acme", crNumber: "", taxNumber: "" })
    set("companyIdentity/u1", { crNumber: "1010123456", taxNumber: "300000000000003", iban: "SA03" })
    const { result } = renderHook(() => useResolvedProfile("u1"))
    expect(result.current.profile).toMatchObject({ name: "Acme", crNumber: "1010123456", taxNumber: "300000000000003", iban: "SA03" })
    expect(result.current.isLoading).toBe(false)
  })

  it("keeps a newer old-field value over a stale identity document (the mobile app writes only the old fields)", () => {
    set("users/u1", { organizationId: "u1", organizationRole: "owner", crNumber: "NEWER" })
    set("companyIdentity/u1", { crNumber: "STALE", taxNumber: "300000000000003" })
    const { result } = renderHook(() => useResolvedProfile("u1"))
    expect(result.current.profile).toMatchObject({ crNumber: "NEWER", taxNumber: "300000000000003" })
  })

  it("is the profile as it was when no identity document exists yet", () => {
    set("users/u1", { organizationId: "u1", organizationRole: "owner", name: "Acme", crNumber: "1010123456" })
    const { result } = renderHook(() => useResolvedProfile("u1"))
    expect(result.current.profile).toMatchObject({ name: "Acme", crNumber: "1010123456" })
  })

  it("treats an account with no organizationRole (a legacy solo account) as the owner", () => {
    set("users/u1", { organizationId: "u1", name: "Solo" })
    set("companyIdentity/u1", { crNumber: "1010123456" })
    const { result } = renderHook(() => useResolvedProfile("u1"))
    expect(result.current.profile).toMatchObject({ crNumber: "1010123456" })
  })

  it("is withheld until the identity document has settled, so nothing latches onto a half-merged profile", () => {
    set("users/u1", { organizationId: "u1", organizationRole: "owner", name: "Acme" })
    set("companyIdentity/u1", null, true)
    const { result } = renderHook(() => useResolvedProfile("u1"))
    expect(result.current.profile).toBeNull()
    expect(result.current.isLoading).toBe(true)
  })

  it("reads a secondary company's identity from that company's own document", () => {
    set("users/u1", { organizationId: "orgS", organizationRole: "owner", name: "Primary", crNumber: "PRIMARY-CR" })
    set("organizations/orgS", { name: "Secondary" })
    set("companyIdentity/orgS", { crNumber: "SECONDARY-CR" })
    const { result } = renderHook(() => useResolvedProfile("u1"))
    expect(result.current.profile).toMatchObject({ name: "Secondary", crNumber: "SECONDARY-CR" })
    expect(subscribed).toContain("companyIdentity/orgS")
    expect(subscribed).not.toContain("companyIdentity/u1")
  })
})

describe("a team member's profile", () => {
  it("never subscribes to the company's identity document, and carries none of it", () => {
    set("users/m1", { organizationId: "orgA", organizationRole: "member", name: "Member" })
    set("users/orgA", { name: "Acme", crNumber: "OWNER-CR", isVerified: true, profileCompleted: true })
    set("companyIdentity/orgA", { crNumber: "OWNER-CR", iban: "SA03" })
    const { result } = renderHook(() => useResolvedProfile("m1"))
    expect(subscribed.filter((p) => p.startsWith("companyIdentity/"))).toEqual([])
    expect(JSON.stringify(result.current.profile)).not.toContain("OWNER-CR")
    expect(JSON.stringify(result.current.profile)).not.toContain("SA03")
  })
})
