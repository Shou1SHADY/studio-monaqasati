/**
 * The new landing at /landing-new is a design trial: served on UAT and in local
 * development, "not found" on production — so merging `uat` into `main` can
 * never put it live by accident.
 */
export function landingNewAllowed(isUat: boolean, nodeEnv: string | undefined): boolean {
  return isUat || nodeEnv === "development"
}
