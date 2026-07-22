# Color Output & ICC Management

Print Upscale Studio processes all AI and local enhancement operations in RGB. CMYK conversion happens only after the RGB result has been written.

## Default workflow

- Output mode: RGB Master + CMYK Copy
- Default profile: ISO Coated v2 (ECI)
- Requested rendering intent: Relative Colorimetric
- Requested black point compensation: enabled
- CMYK format: TIFF, 8-bit, LZW compression
- ICC profile: embedded

## Bundled profiles

The build downloads unchanged profiles from the European Color Initiative:

- ISO Coated v2 (ECI)
- PSO Coated v3 (FOGRA51)
- PSO Uncoated v3 (FOGRA52)

A custom `.icc` or `.icm` profile supplied by the printer can be selected in Settings.

## Important limitation

The CMYK TIFF is a production copy for the designer to continue checking. It is not a final print preflight. The app does not validate total area coverage, process black construction, rich black, spot colors, overprint, trapping, separations, PDF/X compliance or contract proofing.

The feature previously labelled Packaging Preflight is presented to users as Upscale Quality Check because it evaluates RGB upscale artifacts, not final CMYK production readiness.
