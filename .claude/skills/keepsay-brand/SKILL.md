---
name: keepsay-brand
description: Keepsay brand system — colors, typography, motifs, icon rules, copy voice, assets, store links, and standing marketing rules. Use for ANY Keepsay-facing output: web pages, emails, App Store copy, social posts, Story Card concepts, ad scripts, print materials. Ensures first-pass brand consistency across sessions.
---

# Keepsay Brand Skill

Keepsay (by Stubborn Good LLC) preserves voices and memories for the people you love. Every output must feel like a kept letter: warm, permanent, personal. Authenticity is the brand — real voices, real people, real paper.

## Palette
| Token | Hex | Use |
|---|---|---|
| green-deep | #122E24 | dark backgrounds, footers |
| green | #1B4332 | primary brand green, headers, icon tiles |
| green-darkest | #0F2A1F | destination headers (Home/Vault/Profile), dark hero grounds |
| gold | #C9A24B | accents, rules, seals |
| gold-bright | #D4AF37 | CTAs, highlights, stars |
| gold-pale | #F1E4C0 | tints, pills, light text on green |
| cream | #FAF6ED | page backgrounds |
| paper | #FFFDF8 | cards, memory surfaces |
| ink | #25332C | body text |
| ink-soft | #5C6B62 | secondary text |

Never: pure black, pure white backgrounds, saturated non-brand hues (exception: Story Card artwork may use occasion palettes).

## Typography
- **Playfair Display** — headlines, memory titles, seals, anything ceremonial/reflective. Italic + gold for emphasis words. One Playfair element per screen, max.
- **Source Sans 3** — body, UI, buttons, task surfaces.
- The **reveal/memory pages use Lora + Inter** — match what the existing page uses when extending them.
- Small-caps + letter-spacing (.14–.20em) gold eyebrows above headlines.
- Rule: Playfair = *reflect on something*; system font = *do something*. Never Playfair on task/form/modal screens.

## Motifs & iconography
- Signature motifs: gold wax seal with K + heart; sealed cream envelope; heart-over-K monogram; thin gold horizontal rules with a center heart.
- Icons: inline SVG, 1.5px stroke, round caps, gold (#D4AF37) on green tiles. **Emoji are NEVER icons** (they render inconsistently iOS vs Android — ST44).
- Photography: real hands, real objects, warm side-light. No stock-looking strangers; no fantasy/epic imagery (the "knight in armor" Father's-Day creative is off-brand).

## Copy voice
- Warm, plain, second person. Short sentences, one idea each.
- Emotional stakes stated simply: "The day you arrived." "Your voice, kept forever."
- Taglines in use: "Words Today. Memories Forever." · "Your voice. Their story." · "Your life, in your words." · "A story today, a memory forever."
- Avoid: regret-bait ("one day they'll wish…"), feature lists in emotional contexts, exclamation stacking, "unlock/leverage/solution" SaaS-speak.
- The recipient experience is always described as *receiving a gift*, never "content."

## Standing marketing rules (proven — see STATE.md Key Decisions)
- **Show the payoff in ads:** a real person hearing a loved one's voice and reacting. No printer dialogs, feature grids, or 30-card catalogs.
- **Real UI + real people outperform AI-generated creative** (proven on TikTok: real story post 746 likes/217 saves on 4.9k views vs AI montage 16 likes on 20.7k). Avoid outputs that would earn a "Contains AI-generated media" label.
- **Cold-traffic CTA is always free/download (→ `/story`);** the gift ask (→ `/gift`) is for warm audiences or occasion windows only.
- Every marketing page: "Free 14 days · No card," official store badges (never text links), privacy promise ("Your memories are yours forever… never sell your data or show ads").

## Canonical links & assets
- iOS: https://apps.apple.com/app/id6774806816
- Android: https://play.google.com/store/apps/details?id=com.stubborngood.keepsay
- Web: https://www.getkeepsay.com · `/story` (download landing) · `/gift` (gift subs) · `/memory?id=…|?token=…` (reveal). **No `/m/` route exists.**
- Repo assets (keepsay-web): logo-kheart.png, icon.png, envelope_seal.png, PrintedStoryCard.jpeg, memory_placeholder.jpg
- Store badges: Apple `tools.applemediaservices.com/api/badges/...`, Google `play.google.com/intl/en_us/badges/...`

## Pricing (quote exactly)
14-day free trial, full access, no card → **Pro $4.99/mo or $34.99/yr** → **Legacy $9.99/mo or $79.99/yr** (adds video memories + AI writing assist + more storage).
⚠️ **Do NOT quote a storage GB figure** — it's inconsistent across surfaces and unresolved (see STATE.md "Live now → Pricing"). Say "more storage," not a number, until reconciled.
