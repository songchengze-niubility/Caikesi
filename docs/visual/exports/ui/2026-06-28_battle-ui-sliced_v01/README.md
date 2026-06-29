# Battle UI sliced v01

Generated from a single flat UI concept image.

Status: reference only. This package exposed the problem that raw rectangular crops keep the source-image background. Do not copy these slices into `assets/resources/art/` unless a later clean preview and alpha audit pass.

Contents:
- `slices/`: individual PNG crops.
- `layout.json`: source-space positions and scale hints.
- `atlas.png` / `atlas.json`: a simple packed atlas for frontend tests.
- `contact_sheet.png`: quick visual review sheet.
- `preview.html`: overlay preview and asset browser.

Important notes:
- These are crops from a flattened image, not true original layers.
- Raw rectangular crops are not runtime-ready UI components.
- Text should be rebuilt as real labels in Cocos/frontend where possible.
- `circle` slices only make the outside transparent.
- `entities_softmask` files are approximate edge masks; use `entities_raw` if fidelity matters.
- After approval, copy chosen runtime assets into `assets/resources/art/ui/...` and register them in `assets/scripts/art/ArtManifest.ts`.
