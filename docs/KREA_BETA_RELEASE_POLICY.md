# Krea Beta Release Policy

- Keep application version at the current stable value while the module is under development.
- Do not run the stable publish workflow from this branch.
- Do not upload beta installers to the public download repository used by Update Manager.
- Build beta installers manually or through a separate beta-only workflow when the UI is ready.
- Label all beta installers and screens clearly as experimental.
- Merge into the stable production branch only after endpoint validation, controlled image tests and explicit approval.
