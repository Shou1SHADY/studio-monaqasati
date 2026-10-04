import fs from "node:fs"
import path from "node:path"

const CLEAN_FILES = [
  "src/app/[locale]/(admin)/admin/seed/page.tsx",
  "src/app/[locale]/(supplier)/supplier/invoices/page.tsx",
  "src/app/[locale]/(supplier)/supplier/offers/page.tsx",
  "src/components/ChangePasswordDialog.tsx",
  "src/components/ReviewDialog.tsx",
]

const PHYSICAL = /(?<![\w-])(?:ml|mr|pl|pr)-(?:\d|px|auto)|(?<![\w-])(?:left|right)-(?:\d|px|full)|text-(?:left|right)\b|(?<![\w-])border-(?:l|r)(?:-\d)?\b|rounded-(?:l|r)(?:-\w+)?\b/
const DIRECTION_AWARE = /locale\s*===|isRtl|isRTL|isAr\b|rtl:|ltr:|dir="ltr"|dir-ltr|dir=\{|\?\s*['"][^'"]*(?:left|right|ml|mr|pl|pr)[^'"]*['"]\s*:\s*['"]/

describe("RTL-first classes in the screens people use most", () => {
  it.each(CLEAN_FILES)("%s uses logical start/end classes, not hardcoded left/right", (file) => {
    const lines = fs.readFileSync(path.join(process.cwd(), file), "utf8").split(/\r?\n/)
    const offenders = lines
      .map((text, i) => ({ n: i + 1, text: text.trim() }))
      .filter(({ text }) => PHYSICAL.test(text) && !DIRECTION_AWARE.test(text))
    expect(offenders).toEqual([])
  })
})
