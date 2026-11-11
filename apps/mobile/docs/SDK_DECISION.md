# Native SDK decision — November 4, 2026

The owner selected **Expo SDK 58, iOS 16.4+** after reviewing the compatibility
tradeoff. The installed Expo package is 58.0.23; its own compatibility mapping
and Expo Doctor determine the installed native module versions.

| Choice                | Runtime                        | Minimum iOS | Maintenance implication                       |
| --------------------- | ------------------------------ | ----------- | --------------------------------------------- |
| Current stable SDK 58 | React Native 0.88 / React 19.3 | 16.4        | Selected; RN 0.88 is active                   |
| SDK 55                | React Native 0.83 / React 19.2 | 15.1        | Not selected; RN 0.83 is unsupported upstream |

SDK 58 must not be forced to iOS 15.1 or 13. Android configuration raises the
minimum to API 28, retains target API 36, and uses compile API 37. The maintained
SDK and native modules remain on their supported version family.

EAS profiles pin Node 24.22.1, pnpm 11.25.0, stable
`macos-tahoe-26.6-xcode-27.0` and
`ubuntu-26.04-jdk-17-ndk-r27b-sdk-58`. The documented Xcode 27.0 image satisfies
Apple's Xcode 26+ / iOS SDK 26+ upload baseline. This is configuration evidence;
the actual archive's compiler/SDK, entitlements, privacy manifests and signing
must be inspected after a company-authorized native build. The local Mac has
Command Line Tools selected and no usable full Xcode installation, so no local
signed iOS archive is claimed. Hermes/Metro exports do not replace native builds.

Router, Safe Area Context, Screens, SVG, splash screen and development client are
installed. Planned Camera and SecureStore packages have SDK 58 mappings, but
their feature integration and permission/authentication behavior are not part
of this shell. Camera, audio, location, contacts and broad media permissions are
blocked or absent. No camera permission request is made in the Scan shell.

The app has its own nested pnpm workspace and lockfile. This deliberately keeps
installation from rewriting the existing root lockfile or web dependency links.
Metro uses Expo defaults; no legacy watchFolders or nodeModulesPaths overrides
are added. All native app imports are relative or use its installed packages.
Later shared-contract integration must preserve this reproducibility boundary.

Official references checked for this decision:

- [Current Expo compatibility table](https://docs.expo.dev/versions/latest/)
- [Expo SDK 55](https://docs.expo.dev/versions/v55.0.0/)
- [React Native release support](https://reactnative.dev/releases/overview)
- [EAS build images](https://docs.expo.dev/build-reference/infrastructure/)
- [Apple upload requirements](https://developer.apple.com/news/upcoming-requirements/)
- [Expo monorepos](https://docs.expo.dev/guides/monorepos/)
- [Router testing, SDK 58 / RNTL 14](https://docs.expo.dev/router/reference/testing/)
