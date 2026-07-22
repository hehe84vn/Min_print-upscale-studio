# Print Upscale Studio V2.7 — Smart Production Workflow

## Scope

V2.7 combines Smart Analyzer and Batch Production into one local workflow. It does not add new AI model families. Existing local models are selected automatically per image.

## Output scale policy

- Supported fixed scales: 2×, 3×, 4×, 6× and 8×.
- 6× and 8× use one 4× local AI pass followed by Lanczos resize to the final dimensions.
- The app never repeats a 4× AI model to reach 16×.
- 8× is a hard limit in Smart Production and Target Print Size.
- Jobs above the output pixel, RAM or disk safety limits are rejected before processing.

## Smart Analyzer

For each image, the analyzer samples edge density, saturation and luminance contrast, then checks for QR/barcode-like regions. It classifies the source as one of:

- Packaging / artwork
- Text / line art
- Detail-rich image
- General photo

The analyzer recommends a model, scale, detail strength, protection sensitivity and code/text protection flags. Recommendations are advisory in the UI, but Batch Production can apply the recommended model automatically.

## Target Print Size

The user can enter width, height, unit and DPI. The app calculates the required pixel dimensions and effective scale while preserving the source aspect ratio.

If the request needs more than 8×, the job is blocked with guidance to reduce DPI, reduce physical size or use a larger source image.

## Batch Queue

- Multiple input images
- Sequential execution for predictable RAM/GPU use
- Pause after the current job
- Resume queued jobs
- Retry failed jobs
- One failed job does not stop the remaining queue
- JSON production report in the batch output folder
- Per-job RGB output, optional Upscale Quality Check and optional CMYK TIFF copy

The current queue is in-memory. Pause/resume works while the app remains open; reopening the app does not restore an unfinished queue in V2.7.

## Output order

1. Analyze source
2. Check scale, pixel count, estimated working memory and free disk space
3. Run one local AI upscale pass
4. Resize to the final scale when the requested scale is above 4×
5. Save RGB master
6. Run Upscale Quality Check when enabled
7. Create ICC-managed CMYK TIFF when enabled
8. Update `production-report.json`

## Safety limits

- Maximum scale: 8×
- Maximum configured output: 300 megapixels
- Estimated working memory must remain below 60% of total system memory
- Free disk space must cover at least 2.25× the estimated RGB/CMYK output, with a minimum 512 MB reserve

These checks reduce failure risk but do not guarantee that every very large image will process successfully on every GPU or operating system.