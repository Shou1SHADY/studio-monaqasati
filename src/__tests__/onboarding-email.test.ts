import { onboardingEmailHtml } from "@/lib/onboarding-email"

const fields = {
  name: "Ahmad",
  company: "Modern Co",
  phone: "+966 50 123 4567",
  email: "a@b.sa",
  typeLabel: "مقاول، مورّد",
  city: "الرياض",
  size: "10-50",
}

describe("onboarding notification email", () => {
  it("shows every field the visitor gave", () => {
    const html = onboardingEmailHtml(fields)
    for (const v of Object.values(fields)) expect(html).toContain(v)
  })

  it("escapes what the visitor typed so it cannot inject markup", () => {
    const html = onboardingEmailHtml({ ...fields, name: '<img src=x onerror="alert(1)">', company: "A & B <b>", size: "<script>x</script>" })
    expect(html).not.toContain("<img")
    expect(html).not.toContain("<script>")
    expect(html).not.toContain("<b>")
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;")
    expect(html).toContain("A &amp; B &lt;b&gt;")
  })
})
