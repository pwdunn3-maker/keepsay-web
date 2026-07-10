# Legacy Key card — runtime print assets

The Legacy tier's physical Family Access Code card. Full build plan (fulfillment flow,
Gelato API details, and the exact code-stamp coordinates/font/baseline math) lives in the
`luminary-legacy` app repo at `docs/legacy-card-build-plan.md` — read that before touching
anything here.

## Files

- `blank-code.pdf` — the runtime base file. 1 page, 378×522pt (5.25×7.25", = 5×7 + 0.125"
  bleed), CMYK, text outlined, placeholder code area empty. This is what `pdf-lib` stamps
  the Family Access Code onto at order time (see the build plan's "Code stamp spec").
- `print-ready.pdf` — a fully rendered sample (code area already filled/mocked), kept for
  reference/preview — not read by any server function.

## Where these came from

Delivered by the designer (Adobe Illustrator) and originally landed in `~/Downloads` with
no canonical home — found and relocated here 2026-07-10. The Illustrator source file and
the original designer brief are NOT here (no server code needs them) — they live in
`Keepsay-Business/03-Physical-Brand-System/legacy-key-card/` instead.

## Still open (see the build plan for full detail)

- Folded-vs-flat card assembly — unresolved.
- Stamped-code CMYK color — needs a physical Gelato test print to verify, not derivable
  from the source file.
