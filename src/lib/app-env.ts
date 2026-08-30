/**
 * Which deployment this build is.
 *
 * `NEXT_PUBLIC_APP_ENV` is set per App Hosting backend (apphosting.uat.yaml
 * sets "uat"; production leaves it unset). Everything that must differ between
 * environments — robots, the site URL, the warning ribbon, and whether the
 * Firebase config may fall back to production values — reads from here, so
 * there is exactly one switch.
 */
export type AppEnv = "prod" | "uat"

/** The UAT Firebase project. A build bound to it is UAT whatever else is set. */
export const UAT_PROJECT_ID = "mdmaktech-uat"

export const APP_ENV: AppEnv =
  process.env.NEXT_PUBLIC_APP_ENV === "uat" || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === UAT_PROJECT_ID
    ? "uat"
    : "prod"

export const IS_UAT = APP_ENV === "uat"

/**
 * Whether an account must complete its company profile (CR and VAT documents,
 * contact details) before it may publish RFQs or submit offers.
 *
 * Enforced in production, where it is a real compliance requirement. UAT runs
 * on seeded demo accounts that have no genuine commercial register to upload,
 * so the same gate there only blocks the workflows UAT exists to exercise.
 */
export const REQUIRE_COMPLETE_PROFILE = !IS_UAT

/** Public origin of this deployment, without a trailing slash. */
export const SITE_URL: string = (process.env.NEXT_PUBLIC_APP_URL || "https://mdmaktech.sa").replace(/\/$/, "")
