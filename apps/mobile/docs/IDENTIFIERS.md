# Identifier approval

On November 11, 2026, the owner authorized and Apple registration confirmed the
explicit iOS preview bundle ID `com.northsidecollectibles.customer.preview` under
Northside Collectibles Inc., team `NF42JBZCBW`. The preview profile supplies the
approved scheme `northside-collectibles-preview`, Expo owner
`northside-collectibles` and project `ecfde92e-a01e-4158-b0ce-13908afa39ab`.
The same team and bundle are associated with `@northside-collectibles/northside-customer`
on EAS. `MOBILE_PREVIEW_APPLE_TEAM_ID` pins only the selected preview variant.
No signing certificate or provisioning profile was created during registration.

The remaining platform/variant identifiers still need owner review:

| Variant     | iOS / Android candidate                      |
| ----------- | -------------------------------------------- |
| development | `com.northsidecollectibles.customer.dev`     |
| preview Android | `com.northsidecollectibles.customer.preview` |
| production  | `com.northsidecollectibles.customer`         |

The table contains proposals, not verified available identifiers. The registered
iOS preview ID described above is separate from the Android proposal. The configuration does
not read this table or silently use these values. Confirm company ownership,
Apple team/Play records, Expo organization/project, separate return schemes and
API origins before filling the corresponding `MOBILE_*` fields in `.env.local`
and the matching EAS environment for cloud builds. `.env.local` is excluded from
uploads and cannot supply the remote worker's configuration. Associated domains, provider callbacks and
authentication return registration are separate future work.

Run `pnpm build:check preview ios` for the physical iOS interface preview, or
`pnpm build:check development` for the development variant, before EAS commands.
The interface preview requires `MOBILE_IOS_PREVIEW_IDENTIFIERS_APPROVED=true`,
supplied by its iOS profile. Connected variants require
`MOBILE_IDENTIFIERS_APPROVED=true`. The preflight validates the selected variant
locally and starts no build. Raw EAS CLI commands must follow this preflight; the remote
`EAS_BUILD` guard alone does not prevent EAS CLI's earlier local setup prompts.

The production profile describes a future store build. No production build,
upload, submission, release, OTA update or provider configuration is performed
by setup, test or bundle commands.
