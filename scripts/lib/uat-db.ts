// The UAT database for the demo seeds: the service account in the env file when it has one, else the
// signed-in gcloud user (the way deploy-rules.js reaches UAT). UAT ONLY — a key for any other project
// is refused, and the gcloud path is fixed to mdmaktech-uat.

import { execSync } from "child_process"
import { Firestore } from "@google-cloud/firestore"
import { OAuth2Client } from "google-auth-library"

export const UAT_PROJECT = "mdmaktech-uat"

export function openUatDb(): { db: Firestore; via: "key" | "gcloud"; projectId: string } {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const client_email = process.env.FIREBASE_CLIENT_EMAIL
  const private_key = process.env.FIREBASE_PRIVATE_KEY?.replace(/\n/g, "\n")
  if (projectId && client_email && private_key) {
    if (projectId !== UAT_PROJECT) throw new Error(`Refusing: the credentials are for "${projectId}", this seed only touches ${UAT_PROJECT}.`)
    return { db: new Firestore({ projectId, credentials: { client_email, private_key } }), via: "key", projectId }
  }
  const authClient = new OAuth2Client()
  authClient.setCredentials({ access_token: execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim() })
  return { db: new Firestore({ projectId: UAT_PROJECT, authClient }), via: "gcloud", projectId: UAT_PROJECT }
}
