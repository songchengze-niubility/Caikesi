# Battle UI runtime clean v02

This package previews the current runtime PNGs under `assets/resources/art/ui/battle/` after alpha cleanup.

Contents:
- `preview.html`: component browser; each PNG is shown on checkerboard and blue game-like background.
- `contact_sheet.png`: quick visual review sheet.
- `alpha-clean-report.json`: per-file alpha ratios.

Cleanup applied:
- Removed source-image parchment background from profile HUD, resource bars, and wave progress.
- Kept intentionally opaque panel assets: `nav/nav_bar_full.png`, `stage/chapter_banner.png`, `stage/reward_card.png`.

Verification:
- `npm run check:ui-alpha`
- `npm run check:art`
- `npm run test:art`

Rule going forward: raw rectangular crops remain reference-only; runtime UI assets need transparent component edges or an explicit opaque-panel exception.
