# CLAUDE.md — keepsay-web (Keepsay marketing + share/reveal site)

This is the **web** repo (getkeepsay.com, deployed on Vercel). The Keepsay **app** lives in the sibling
`luminary-legacy` repo, which holds the product's single source of truth.

## Read first — every session
- **Product state = `../luminary-legacy/STATE.md`.** Read it before any task. If that directory isn't
  accessible, ask the user to run `/add-dir ../luminary-legacy` (or paste STATE.md). Claude Code reads
  across sibling folders once the directory is granted.
- Brand system: the **`keepsay-brand` skill** (`.claude/skills/keepsay-brand/`). Use it for any
  Keepsay-facing output (pages, copy, ad scripts, Story Card concepts).

## What this repo is
Static HTML + Vercel serverless (`/api`). Key surfaces: `/` homepage · `/story` (download landing) ·
`/gift` (Stripe gifting) · `/memory?id=…|?token=…` (share/reveal, fed by `api/get-memory.js`). Routes live
in `vercel.json`. No build step for the pages — hand-written HTML with brand tokens inline. There is **no
`/m/` route**.

## Conventions
- Honor the brand skill (palette, Playfair/Source-Sans, Lora+Inter on reveal pages, no emoji-as-icons).
- Marketing pages: cold-traffic CTA → `/story` (free/download), not `/gift`; "Free 14 days · No card";
  official store badges (never text links); privacy promise in the footer.
- **Never commit secrets** (Stripe/Supabase/service-role keys live in Vercel env, not the repo).
- Verify visual changes with a screenshot before committing. Commit locally; **ask before pushing (push = deploy to prod).**

## Documentation rules (strict)
- **Never create new .md docs/summaries/handoff/report files.** Product state → `../luminary-legacy/STATE.md`;
  web conventions → this file. If it fits neither, say it in chat — do not write a file.
- After shipping a web change, the matching STATE.md line is updated in `luminary-legacy` (the page commits
  here; the one-line state change commits there).
