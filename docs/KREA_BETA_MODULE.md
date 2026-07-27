# Krea AI Lab Beta

This module is intentionally isolated from the stable release and automatic-update channel.

## Goals

- Keep every current local, restore, text/artwork and vector workflow unchanged.
- Add Krea as an optional cloud candidate for controlled A/B testing.
- Store the Krea API token through `SecureSecretsService` only.
- Save Krea output to a separate file and never overwrite the local result.
- Report queued, processing, completed and failed states to the renderer.

## Current beta foundation

- `src/main/services/kreaBetaService.js`: token access, auth probe, job submission, polling and output download.
- `src/main/kreaBetaIpc.js`: isolated IPC registration and progress events.
- `src/main/preload.js`: renderer-safe Krea beta bridge.
- `scripts/krea-beta-smoke.mjs`: regression checks for secret handling and IPC wiring.

## Important endpoint note

Krea exposes a job-based REST API, but enhancer model routes and request schemas may change as their catalog evolves. The beta service therefore requires the enhancer endpoint to be supplied by the beta UI/configuration after it is verified against the current official Krea model documentation. No stable feature should hard-code an unverified model route.

## Distribution rule

Do not merge this branch into the stable release source and do not publish it to `Print-Upscale-Studio-Downloads`. Beta installers must be built manually and shared only with designated testers.
