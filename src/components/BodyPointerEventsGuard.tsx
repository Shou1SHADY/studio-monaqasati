"use client"

/**
 * Releases `body { pointer-events: none }` when Radix leaks it.
 *
 * Radix sets that style while a modal layer is open and removes it on close. When a
 * Select (or any popper layer) is opened *inside* a Dialog and both are dismissed in
 * the same gesture — Escape to close the Select, Escape again to close the Dialog —
 * the layers unmount out of order and the style is never cleared. The result is a
 * page that renders perfectly and ignores every click until the user reloads.
 *
 * Thirteen screens in this app pair a Dialog with a Select, so this is fixed once
 * here rather than worked around per dialog. The guard only acts when the style is
 * set and *no* Radix layer is actually mounted, so it can never fight a real modal.
 */

import { useEffect } from "react"

/** Selectors for any layer that legitimately wants the page behind it inert. */
const OPEN_LAYER_SELECTORS = [
  "[role='dialog']",
  "[role='alertdialog']",
  "[role='listbox']",
  "[role='menu']",
  "[data-radix-popper-content-wrapper]",
].join(",")

export function BodyPointerEventsGuard() {
  useEffect(() => {
    const release = () => {
      const { body } = document
      if (body.style.pointerEvents !== "none") return
      if (document.querySelector(OPEN_LAYER_SELECTORS)) return // a real layer is open
      body.style.removeProperty("pointer-events")
      if (!body.getAttribute("style")?.trim()) body.removeAttribute("style")
    }

    // Radix removes its own style asynchronously on close; checking on the next frame
    // avoids clearing the style out from under a layer that is still tearing down.
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(release)
    }

    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"] })
    // Layers unmount without necessarily touching body's style attribute, so watch
    // the tree they live in too.
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return null
}
