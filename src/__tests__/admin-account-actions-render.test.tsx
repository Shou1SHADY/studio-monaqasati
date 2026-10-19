import { fireEvent, render, screen } from "@testing-library/react"
import { AccountRowActions } from "@/components/admin/AccountRowActions"

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})

const labels = { view: "View", components: "Components", verify: "Verify", unverify: "Unverify", needsDocs: "Needs the CR and VAT documents first" }

const setup = (over: Partial<React.ComponentProps<typeof AccountRowActions>> = {}) => {
  const fns = { onView: jest.fn(), onComponents: jest.fn(), onVerify: jest.fn() }
  render(<AccountRowActions labels={labels} verified={false} canVerify {...fns} {...over} />)
  return fns
}

describe("an account row's actions", () => {
  it("every account gets View, Components and Verify as named icon buttons", () => {
    const fns = setup()
    fireEvent.click(screen.getByRole("button", { name: "View" }))
    fireEvent.click(screen.getByRole("button", { name: "Components" }))
    fireEvent.click(screen.getByRole("button", { name: "Verify" }))
    expect(fns.onView).toHaveBeenCalledTimes(1)
    expect(fns.onComponents).toHaveBeenCalledTimes(1)
    expect(fns.onVerify).toHaveBeenCalledWith(true)
  })

  it("a verified account offers Unverify instead", () => {
    const fns = setup({ verified: true })
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Unverify" }))
    expect(fns.onVerify).toHaveBeenCalledWith(false)
  })

  it("Verify without the required documents is disabled and says why", () => {
    const fns = setup({ canVerify: false })
    const verify = screen.getByRole("button", { name: /Verify — Needs the CR and VAT documents first/ })
    expect(verify).toBeDisabled()
    expect(verify.closest("span")).toHaveAttribute("title", "Needs the CR and VAT documents first")
    fireEvent.click(verify)
    expect(fns.onVerify).not.toHaveBeenCalled()
  })
})
