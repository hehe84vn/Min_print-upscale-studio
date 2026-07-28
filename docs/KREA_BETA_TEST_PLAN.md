# Krea Beta Evaluation Plan

Use the same source files for local and Krea outputs. Never compare unrelated crops, different target dimensions or recompressed sources.

## Test sets

1. Natural photos: portraits, products, interiors and outdoor photography.
2. Low-resolution photos: small JPEG, heavy compression, mild blur and old scans.
3. Product / CGI: mockups, 3D renders, reflective surfaces and synthetic materials.
4. Packaging artwork: small text, logos, gradients, barcodes and fine linework.
5. Illustration: textured art, line art and flat graphics.

## Required preset matrix

- Auto.
- Print Faithful — Upscale High Fidelity V3.
- Text & Graphic — Text Refine.
- Low Resolution Restore — Low Resolution V2.
- Product / CGI — CGI.
- Photo Standard — Standard V2.
- Photo Recovery — Recovery V2.
- Photo Detail — Detail.
- Creative Photo — Krea Enhance.
- Creative Illustration — Topaz Bloom.

Run the first comparison at 2×. Only test 4× or a larger target after reviewing the 2× crop at 100%.

## Required comparisons

- Original vs current local workflow.
- Original vs selected Krea preset.
- Local result vs Krea result at exactly matched output dimensions.
- Auto route vs the manually selected expected preset.
- Krea downloaded size vs final exact geometry written by the app.

## Record for every run

- Source dimensions, format, RGB color space, DPI metadata and file size.
- Requested preset and resolved preset.
- Krea family/model and route reason.
- Requested scale or target long edge.
- Processing duration and any retry/rate-limit event.
- Raw Krea output dimensions and final normalized dimensions.
- Text/logo fidelity.
- Face/product geometry fidelity.
- Color and tonal drift.
- Added or hallucinated detail.
- Transparency changes.
- Overall usefulness for print production.

## Automatic failure conditions

- Output aspect ratio differs from the requested ratio by more than 0.5%.
- Final output does not exactly match the requested pixel geometry.
- Text, logo, barcode, QR code or product geometry changes in a protected workflow.
- Creative detail appears in Print Faithful or Text & Graphic without user consent.
- Output is corrupted, empty, unexpectedly tiny or cannot be decoded by Sharp.
- Krea errors expose the API key, raw internal payload or full job response to the renderer.

## Pass criteria

Krea is useful only when it provides a visible quality benefit without changing protected text, logos, identities, product geometry or composition. A visually attractive result that changes protected content is a failure for the print workflow.

No preset is production-ready until it passes controlled live API runs, Golden Tests, syntax/smoke checks, Windows build and macOS build.
