/**
 * Companies' legal documents in Cloud Storage (supplier onboarding, 18 Oct 2026): only their uploader reads, lists or
 * writes them through Storage — the catch-all used to let any signed-in user list and overwrite every company's CR,
 * tax certificate and IBAN letter. Everyone else who may see one opens it by the link saved on the company's record.
 */

import fs from "fs"
import path from "path"
import { uploadSupplierFile } from "@/lib/supplier-free/uploads"

jest.mock("firebase/storage", () => ({
  ref: (_s: unknown, p: string) => ({ p }),
  uploadBytes: jest.fn(async () => ({})),
  getDownloadURL: jest.fn(async (r: { p: string }) => `https://files/${r.p}`),
}))

const rules = fs.readFileSync(path.join(__dirname, "..", "..", "storage.rules"), "utf8").replace(/\/\/[^\n]*/g, "")
const flat = rules.replace(/\s+/g, " ")

describe("storage.rules", () => {
  it("has no open catch-all over every path any more", () => {
    expect(rules).not.toMatch(/match \/\{allPaths=\*\*\}/)
    expect(flat).toContain("match /{top}/{rest=**} { allow read, write: if request.auth != null && top != 'legalDocuments' && top != 'suppliers'; }")
    expect(flat).toContain("match /suppliers/{orgId}/{folder}/{rest=**} { allow read, write: if request.auth != null && folder != 'documents'; }")
  })
  it("lets only the uploader reach a company's legal documents", () => {
    expect(flat).toContain("match /legalDocuments/{uid}/{rest=**} { allow read, write: if request.auth != null && request.auth.uid == uid; }")
    expect(flat).toContain("match /suppliers/{orgId}/documents/{uid}/{fileName} { allow read, write: if request.auth != null && request.auth.uid == uid; }")
    expect(flat).toContain("match /suppliers/{orgId}/documents/{fileName} { allow read, write: if request.auth != null && request.auth.uid == orgId; }")
  })
})

describe("uploadSupplierFile", () => {
  const file = { name: "السجل التجاري.pdf" } as File
  it("puts a company document under its uploader's id", async () => {
    const up = await uploadSupplierFile({} as never, "org1", "documents", file, "u7")
    expect(up.path).toMatch(/^suppliers\/org1\/documents\/u7\/\d+-/)
  })
  it("refuses a company document without its uploader, and leaves the other folders as they were", async () => {
    await expect(uploadSupplierFile({} as never, "org1", "documents", file)).rejects.toThrow()
    expect((await uploadSupplierFile({} as never, "org1", "quotes", file)).path).toMatch(/^suppliers\/org1\/quotes\/\d+-/)
  })
})
