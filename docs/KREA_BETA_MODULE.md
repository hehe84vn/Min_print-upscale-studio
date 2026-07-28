# Krea Cloud Beta — Krea-only architecture

This module is intentionally isolated from the stable release and automatic-update channel.

## Product decision

- KiraAI has been removed from the renderer, preload bridge, IPC layer and main-process services after real packaging tests showed unacceptable changes to typography, logos, composition and product details.
- Krea is the only cloud provider in the AI Enhance workflow.
- Local upscale, restore, text/artwork, vector, Model Studio and Update Manager remain unchanged.

## Krea Skill principles applied

The implementation follows the supplied Krea agent skills and current official Krea API schemas:

1. Use faithful enhancement by default when preservation matters.
2. Keep creative enhancement behind explicit creative presets and warnings.
3. Upload local inputs through `POST /assets`; never expose the API key to the renderer.
4. Submit a job, poll server-side, handle terminal failure states and report progress.
5. Retry `429` with backoff and retry transient server failures once.
6. Do not return raw Krea responses or request payloads to the renderer.
7. Validate input, output URL, output dimensions and aspect ratio.
8. Normalize the downloaded result to the exact requested pixel geometry before export.
9. Treat output review and Golden Tests as mandatory before a preset is promoted from beta.

## Current preset router

- `Auto`: routes to Text Refine when text/logo protection is enabled, Low Resolution V2 for small sources, Creative Photo only when Creative is explicitly requested, otherwise Print Faithful.
- `Print Faithful`: Topaz `Upscale High Fidelity V3`.
- `Text & Graphic`: Topaz `Text Refine`.
- `Low Resolution Restore`: Topaz `Low Resolution V2`.
- `Product / CGI`: Topaz `CGI`.
- `Photo Standard`: Topaz `Standard V2`.
- `Photo Recovery`: Topaz Generative `Recovery V2` with conservative controls.
- `Photo Detail`: Topaz Generative `Detail` with conservative controls.
- `Creative Photo`: Krea Enhance with high resemblance and color rescaling.
- `Creative Illustration`: Topaz Bloom with explicit creative warning.

## Module layout

- `src/main/services/kreaBetaService.js`: secure token access, input validation, asset upload, preset routing, payload building, retry, polling, download, exact-geometry export and output QA.
- `src/main/kreaBetaIpc.js`: isolated IPC registration and progress events.
- `src/main/preload.js`: renderer-safe Krea bridge.
- `src/renderer/krea-beta-ui.js`: Krea provider settings, print-oriented presets, size preview and result warnings.
- `scripts/krea-beta-smoke.mjs`: regression checks for Krea-only wiring and removal of KiraAI.

## Important validation boundary

The code is aligned to the current documented schemas, but a real API token and controlled source images are still required to confirm every preset against live Krea behavior. A model name existing in documentation is not sufficient evidence of production quality.

## Distribution rule

Do not merge this branch into the stable release source and do not publish it to `Print-Upscale-Studio-Downloads`. Beta installers must be built manually and shared only with designated testers until API tests, Golden Tests and build validation pass.
