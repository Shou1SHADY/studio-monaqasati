import fs from "fs"
import path from "path"

const APP = path.join(process.cwd(), "src/app/[locale]")
const read = (p: string) => fs.readFileSync(p, "utf8")
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))

describe("pages that open the phone sign-in sit under a Firebase provider", () => {
  const files = walk(APP)
  const users = files.filter((f) => /\.tsx$/.test(f) && /JoinFreeButton|PhoneSignInDialog/.test(read(f)))

  it("finds the guest RFQ and guest offer pages", () => {
    const names = users.map((f) => path.relative(APP, f).replace(/\\/g, "/"))
    expect(names).toEqual(expect.arrayContaining(["rfq/[token]/PublicRfqContent.tsx", "offer/[token]/GuestOfferContent.tsx"]))
  })

  it.each(users.map((f) => [path.relative(APP, f).replace(/\\/g, "/"), f]))("%s has a layout above it that mounts FirebaseClientProvider", (_name, file) => {
    let dir = path.dirname(file)
    let provided = false
    while (dir.startsWith(APP)) {
      const layout = path.join(dir, "layout.tsx")
      if (fs.existsSync(layout) && /FirebaseClientProvider/.test(read(layout))) {
        provided = true
        break
      }
      dir = path.dirname(dir)
    }
    expect(provided).toBe(true)
  })
})
