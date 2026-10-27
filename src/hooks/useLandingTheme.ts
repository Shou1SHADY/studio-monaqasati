"use client"

import { useCallback, useEffect, useState } from "react"

export type LandingTheme = "light" | "dark"

export const LANDING_THEME_KEY = "mdmak-landing-theme"

/** Light unless the visitor chose dark before (the choice is remembered on this device). */
export function storedLandingTheme(raw: string | null): LandingTheme {
  return raw === "dark" ? "dark" : "light"
}

/**
 * Runs before the page paints (inline in the landing's root) so a visitor who chose dark
 * never sees a light flash. Kept as a string: it executes before React hydrates.
 */
export const LANDING_THEME_BOOT = `try{if(localStorage.getItem(${JSON.stringify(LANDING_THEME_KEY)})==="dark")document.getElementById("ln-root").classList.add("dark")}catch(e){}`

export function useLandingTheme() {
  const [theme, setTheme] = useState<LandingTheme>("light")

  useEffect(() => {
    try {
      setTheme(storedLandingTheme(window.localStorage.getItem(LANDING_THEME_KEY)))
    } catch {
      // Storage blocked (private mode): stay light.
    }
  }, [])

  const toggle = useCallback(() => {
    setTheme(prev => {
      const next: LandingTheme = prev === "dark" ? "light" : "dark"
      try { window.localStorage.setItem(LANDING_THEME_KEY, next) } catch { /* not remembered */ }
      return next
    })
  }, [])

  return { theme, toggle }
}
