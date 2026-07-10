# Physical products — runtime print assets

This folder holds the files server code actually reads at order/fulfillment time (e.g. a
Vercel function stamping a personalized code onto a blank print file before sending it to
Gelato). It does NOT hold design source files (`.ai`, designer briefs) — those live in
`Keepsay-Business/03-Physical-Brand-System/` on the same per-product-slug pattern, since no
server code ever touches them directly. See that folder's own README for why the split.

## Convention

One folder per product, named with a plain kebab-case slug matching how the product is
referred to in code/docs (e.g. `legacy-key-card`). Fixed filenames inside every product
folder — `print-ready.pdf`, `blank-code.pdf` (if the product stamps something onto a blank
runtime file), etc. — so a path never has to be guessed or grepped for; it's predictable
from the slug alone.

## Products

| Slug | What it is | Coordinate/stamp spec lives at |
|---|---|---|
| `legacy-key-card/` | The Legacy tier's physical Family Access Code card, mailed via Gelato | `luminary-legacy` repo, `docs/legacy-card-build-plan.md` ("Code stamp spec" section) |

Add a row here every time a new product folder is created — this table is the map.
