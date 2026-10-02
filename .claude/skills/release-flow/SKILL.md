---
name: release-flow
description: Ship finished work on Studio Monaqasati end to end — checks, commit, push main (prod), merge and push uat, confirm the UAT build is READY, and track it in Jira DEV. Use when the owner says ship, release, deploy, push, or "commit and push" after a task is done.
allowed-tools: Read, Edit, Bash, Grep, Glob
---

# Release flow

Run these steps in order. Stop and report at the first failure; never skip a hook or force-push.

## 0. Authority

The owner granted standing permission (2026-10-01) to commit, push `main` and `uat`, and handle Jira. Still ask before: force-push, deploying `firestore.rules` over live rules that match no commit, anything destructive. If the auto-mode classifier blocks a push, ask with AskUserQuestion instead of working around it.

## 1. Sync first

```bash
git fetch origin
git log HEAD..origin/main --oneline
```

If origin is ahead, merge it before anything else. Other sessions push here. If `firestore.rules` changed on origin, diff it before touching rules.

## 2. Checks (all must pass)

```bash
npx tsc --noEmit
npx jest
node scripts/check-i18n-links.mjs
npx eslint <changed files>
```

- tsc: the only accepted errors are in `src/__tests__/lib-seo.test.ts` and `src/ai/generate.ts`.
- i18n: 0 missing keys, 0 one-language keys, 0 dead links.
- Every fix has a test that fails without it.
- Changed a file mirrored into mobile (list in mobile `scripts/check-mirrors.mjs`)? Re-copy it whole, run `node scripts/check-mirrors.mjs <webDir>`, then mobile `npx tsc --noEmit` and `npx jest`. The mobile repo is pushed separately.
- New or changed collection? `firestore.rules` updated, deployed to UAT first (`node scripts/deploy-rules.js uat --check`, then without `--check`), then prod.

## 3. Commit

- `git status`, then stage specific files by name. Never `.claude/settings.json`, never `.env*`.
- One commit per batch (message files mix hunks). Short why-focused message, with the Jira key when there is one.
- Trailer from the session's attribution reminder, normally `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- The pre-commit hook runs tsc, tests and a production build (several minutes). If it fails, fix the cause and make a NEW commit.

## 4. Push main, then uat

```bash
git push origin main
git stash push .claude/settings.json   # only if it has local edits
git checkout uat && git merge main && git push origin uat
git checkout main && git stash pop
```

`uat` must never be behind `main`, and is never rewritten. `main` auto-deploys prod on Vercel; `uat` auto-deploys on App Hosting. Do not trigger builds by hand.

## 5. Confirm UAT is READY

List builds, newest first, and read the state of the newest one. A failed build is silent and the site keeps serving the old one.

```bash
TOKEN=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: mdmaktech-uat" \
  "https://firebaseapphosting.googleapis.com/v1/projects/mdmaktech-uat/locations/us-east4/backends/studio-monaqasati/builds?pageSize=100"
```

Wait with a Monitor until-loop on the build's `state` (BUILDING, then DEPLOYING, then READY). Do not use `sleep` polling. On FAILED, read the Cloud Build log (see "When UAT looks stale" in CLAUDE.md) before concluding anything.

## 6. Jira (cloudId `f31eee5b-9ca0-495e-9a94-582c48d8c899`, project DEV)

- Each finding or piece of work has a DEV issue. Create it with `createJiraIssue` (`issueType: "Task"`), or find the existing one.
- Close with `transitionJiraIssue` and `transitionId: 61` (Task, Done). Bug and New Feature use 2 Assign, 3 Start work, 9 Resolved.
- Put the commit hash in the issue description or a comment (`addOrEditJiraIssueComment`). Labels: `shipped`, `uat-YYYY-MM-DD`.
- Do not pass an `update` param to the transition; it fails.

## 7. Report

Two sentences at most: the commit hash, which branches it reached, the UAT build state, and the Jira key. Mention anything left open (mobile repo unpushed, `CRON_SECRET`, etc.).

## Gotchas

- Bash heredocs with apostrophes or backticks break quoting. Write helper scripts with the Write tool into the scratchpad and run them.
- Message files (`messages/ar.json`, `messages/en.json`): edit with a JSON OrderedDict script, `ensure_ascii=False`, `indent=2`, keep the trailing newline and line endings.
- Never type passwords or submit sign-in forms on UAT; the owner signs in. Irreversible test actions need the owner's OK.
