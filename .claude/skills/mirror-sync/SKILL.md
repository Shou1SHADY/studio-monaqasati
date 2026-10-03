---
name: mirror-sync
description: Keep the mobile app's verbatim copies of website files in step with Studio Monaqasati. Use after changing any file the mobile repo mirrors (procurement types/po/receipts/supplier, mfg-events, sales-numbering, accounting, crm, permissions, project-sections and more), when check-mirrors reports DRIFT or REVIEW, or before shipping a change that touches shared domain logic.
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# Mirror sync (website to mobile)

The Expo app (`C:\Users\HP\Downloads\_Projects\mdmak-mob\artifacts\mobile`, repo `Shou1SHADY/mdmak-mob`, branch `main`) copies some website modules verbatim so both apps agree by construction. The list is `MIRRORS` in the mobile `scripts/check-mirrors.mjs`; hand-adapted files are in `UPSTREAM_PINS` and pinned by SHA-256 in `scripts/mirror-lock.json`.

## 1. Detect

```bash
cd ~/Downloads/_Projects/mdmak-mob/artifacts/mobile
node scripts/check-mirrors.mjs /c/Users/HP/Downloads/studio-monaqasati
```

- `DRIFT` = a verbatim copy differs from the website. Re-copy it.
- `REVIEW` = the website changed a file a hand-adapted mobile file is built from. Re-read the adaptation against the changed upstream.
- `MISSING` = a path moved or was deleted on one side. Fix the map in `check-mirrors.mjs`.
- Exit 0 and no DRIFT/REVIEW means nothing to do.

Fast path from the website side: `git diff --name-only` and match against the `MIRRORS` values to see which mirrored files you touched.

## 2. Fix DRIFT: re-copy whole, never hand-patch

1. Copy the website file over the mobile one in full.
2. Re-apply the mobile file's leading `//` header comment (the comparison ignores leading comment lines and blank lines, so the header is free). Read the old header first; if the copy overwrote it, restore it from `git show HEAD:<path>`.
3. The one rebased file (`waste-writes.ts`) keeps its documented import swap; check the `REBASED` block before overwriting it.

## 3. Fix REVIEW: adapt, then re-pin

1. Read the upstream website file diff (`git log -p -- <web path>`) and the mobile adaptation side by side.
2. Port whatever the change means for mobile (new field, rule, i18n key). If nothing applies, say so in the commit message.
3. Only then refresh the lock: `node scripts/check-mirrors.mjs /c/Users/HP/Downloads/studio-monaqasati --update-lock`.

## 4. Verify the mobile repo

```bash
node scripts/check-mirrors.mjs /c/Users/HP/Downloads/studio-monaqasati   # no DRIFT, no REVIEW
npx tsc --noEmit
npx jest
```

Mobile `typecheck` is `tsc -p tsconfig.json --noEmit`. A website change that alters a mirrored function's behavior needs the mobile tests to pass, not just the copy to match.

## 5. Commit, and push only with the owner's yes

- Message style in that repo: `chore(mirror): re-copy <files> from the website`.
- `git status` first and stage specific files. Trailer from the session's attribution reminder.
- The mobile repo is pushed separately from the website and the standing push grant covers the website only (`main`/`uat`). Ask before pushing mobile. A pending local mobile commit (80713fb at last count) is already waiting on this.

## 6. Order of work when both repos change

1. Finish and check the website change (`release-flow` steps 1 to 3).
2. Sync mirrors and verify mobile (this skill).
3. Ship the website (`release-flow` 3 to 6); mention the unpushed mobile commit in the report.

## Gotchas

- Do not edit a mirrored file in mobile first; the website is the source of truth.
- Line endings are normalized in the comparison, so CRLF vs LF alone is not drift.
- If a mirrored website file imports something web-only, the mobile copy will not compile. Move the shared part into a mirrored module instead of forking the file.
