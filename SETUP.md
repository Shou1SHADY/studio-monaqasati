# Manual Setup — Login Hint Feature

These steps require access to external consoles and cannot be automated.

## 1. Firebase Admin SDK credentials

1. Open [Firebase Console](https://console.firebase.google.com) → your project → **Project Settings** → **Service Accounts**.
2. Click **Generate new private key** → download the JSON file.
3. Set these three Vercel environment variables (Settings → Environment Variables):

   | Variable | Where to find it |
   |---|---|
   | `FIREBASE_PROJECT_ID` | `project_id` field in the JSON |
   | `FIREBASE_CLIENT_EMAIL` | `client_email` field in the JSON |
   | `FIREBASE_PRIVATE_KEY` | `private_key` field — paste the full value including `-----BEGIN PRIVATE KEY-----` and the literal `\n` sequences |

   > **Tip:** In Vercel's UI, paste the key exactly as it appears in the JSON (with `\n` as two characters). The code applies `.replace(/\\n/g, "\n")` at runtime.

## 2. Upstash Redis (rate limiter)

1. Go to [console.upstash.com](https://console.upstash.com) → **Create Database** → choose the region closest to your Vercel deployment.
2. Open the database → **REST API** tab → copy **UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN**.
3. Add both as Vercel environment variables.

## 3. Redeploy

After adding all five variables in Vercel, trigger a redeploy so the new env vars are picked up:

```
vercel --prod
```

or push a commit / click **Redeploy** in the Vercel dashboard.

## 4. Local development

Copy `.env.example` to `.env.local` and fill in real values. `.env.local` is already gitignored.

```bash
cp .env.example .env.local
```

The rate limiter gracefully skips itself if the Upstash vars are missing, so local dev works without Redis.
