# Krea Beta Evaluation Plan

Use the same source files for local and Krea outputs. Never compare unrelated crops or recompressed sources.

## Test sets

1. Natural photos: portraits, products, interiors and outdoor photography.
2. Packaging artwork: small text, logos, gradients, barcodes and fine linework.
3. Vector preprocessing: low-resolution flat logos, seals and line art.

## Required comparisons

- Original vs current local workflow.
- Original vs Krea standard.
- Original vs Krea generative.
- Local result vs Krea result at matched output dimensions.

## Record for every run

- Source dimensions and file type.
- Selected Krea endpoint/model and mode.
- Requested scale.
- Processing duration.
- Output dimensions and size.
- Text/logo fidelity.
- Face/product geometry fidelity.
- Added or hallucinated detail.
- Overall usefulness for print production.

## Pass criteria

Krea is considered useful only when it provides a visible quality benefit without changing protected text, logos, identities, product geometry or composition. A visually attractive result that changes protected content is a failure for the print workflow.
