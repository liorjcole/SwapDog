# WatchDog Agent Instructions

## Branch and Repo

- The active development branch is `react-native`, not `main`.
- `main` is stale/near-empty. Cut feature branches from `react-native` and target PRs back into `react-native`.
- App branding is WatchDog, while the repo, bundle ID, and slug still carry the legacy SwapDog name.
- `CLAUDE.md` imports this file, so keep shared agent guidance here.

## Expo and Native Changes

- This app uses Expo SDK `~54.0.33`, React Native `0.81.5`, React `19.1.0`, and the New Architecture.
- Read the exact SDK 54 docs at https://docs.expo.dev/versions/v54.0.0/ before writing native-touching code.
- Native module registration can only be fully proven with an EAS build or a local macOS Release build. `expo-modules-autolinking resolve` only shows what should link.

## Critical Null and Undefined Guards

Never skip these:

1. `uploadAsync()` can return undefined. Guard with `if (!result || !result.body)` before reading any property.
2. `fetch()` responses must be guarded with `if (!response || !response.ok)` before `.json()`, `.body`, or `.status`.
3. `JSON.parse` results must be optional-chained, for example `data?.field`.
4. All photo uploads must go through `src/utils/uploadHelper.ts`. Do not write inline `uploadAsync` calls.
5. `route.params` must always be optional-chained, for example `route.params?.field`.
6. Firestore `doc.data()` must be guarded, for example `const d = doc.data(); if (!d) return;`.

## Quality Bar

- Run `npx tsc --noEmit` after every sub-step. TypeScript must have zero errors before committing.
- Run `npm run lint` before handing off changes when practical.
- Run relevant `npm run test:*` scripts for touched behavior.
- Do not use `as any` to silence type errors.
- If a prompt contains `LONG`, work in small production-quality steps, QA after each step, and iterate until the result is solid.

## Dependency Gotchas

- Keep the pinned override in `package.json`: `"overrides": { "expo-font": "~14.0.11" }`.
- Do not remove that override. Dependency drift previously pulled in an incompatible `expo-font@56.x`, causing `Cannot find native module 'ExpoFontLoader'` and a white screen before React mounted.
- After any dependency change, run `expo install --check` and `npm ls expo-font`.
- `npm ls expo-font` must show a single SDK 54-compatible `14.0.x` version. No `56.x` Expo modules should appear.

## Firebase and Security Gotchas

- Reviews require the Firestore composite index `(revieweeId ASC, createdAt DESC)`, defined in `firestore.indexes.json`.
- `firebase.json` must include `"indexes": "firestore.indexes.json"` in the `firestore` block so `firebase deploy --only firestore:indexes` actually deploys it.
- Security rules are intentionally locked down. Clients cannot rewrite their own aggregate fields such as rating, points, or vetting.
- Server-side aggregate writes should go through Cloud Functions. Do not loosen rules to hide a permission error.

## Build and Deploy Notes

- No OTA updates are configured. There is no `expo-updates`; JS ships inside each binary.
- Before an iOS production build, bump `ios.buildNumber` in `app.json`.
- Firebase deploy commands:
  - Rules: `firebase deploy --only firestore:rules,storage`
  - Indexes: `firebase deploy --only firestore:indexes`
  - Functions: `cd functions && npm run build && firebase deploy --only functions`
