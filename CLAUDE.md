# radiology-expertly-dicom-viewer

A **fork of the OHIF v3 Medical Imaging Viewer** (zero-footprint web DICOM viewer), customized for Radiology Expertly. Package name is still upstream (`ohif-monorepo-root`, v3.13.0-beta.59). Working branch: `feature/custom-tweaks`.

**The fork's differentiators** (most code is upstream OHIF):
- **Gaze / eye-tracking heatmap** (webcam via EyeGestures + a local Python sidecar + browser clients)
- **Head-tracking** (`@mediapipe/tasks-vision`)
- **Study review / question / feedback panels** (custom radiology assessment workflow)

> ⚠️ This is a large upstream fork. Treat `platform/*` framework code cautiously and **prefer adding features via extensions/modes**, not by editing upstream files. Custom code is concentrated in the two locations listed below.

## Stack

- TypeScript + JavaScript (React, `jsx: react`), ES2022, `moduleResolution: bundler`
- Imaging: **Cornerstone3D** (`@cornerstonejs`), `dcmjs`, DICOMweb
- Monorepo: **Yarn 1 workspaces** (`yarn@1.22.22`) + **Lerna** + **Nx**. (`bun.lock` present but yarn is primary.)
- Build: Webpack (`.webpack/`) with alternate **rsbuild** config; Babel; PostCSS + Tailwind
- Custom deps: `@mediapipe/tasks-vision`, `execa`
- Tests: Jest (unit) + Playwright (e2e) + Cypress
- Node `.node-version` 20.9.0; Python 3.8 for the gaze sidecar

## Commands (from repo root, `yarn`)

- Install: `yarn install --frozen-lockfile`
- Dev (all): `yarn dev` / `yarn start`. **Fast single-app:** `yarn dev:fast`. With data source: `yarn dev:orthanc` / `dev:dcm4chee` / `dev:static`.
- Local Orthanc: `yarn orthanc:server` (docker) — see **`LOCAL_SETUP.md`** for the full nginx CORS-proxy workflow.
- Build (prod): `yarn build` → `platform/app/dist`. Variants: `build:dev|ci|qa|demo`.
- Unit tests: `yarn test:unit` (jest + coverage); single: **`yarn jest <path>`**; watch: `yarn test-watch`.
- E2E: `yarn test:e2e` (Playwright); test data: `yarn test:data` (git submodule).
- Lint/format: Prettier via lint-staged + Husky pre-commit. ESLint configured but no root `lint` script — run directly.
- Cornerstone3D dev: `cs3d:checkout|build|watch|link|install`.
- **Gaze sidecar (Python):** `python3 .scripts/eyegestures_sidecar.py --port 8765` (deps `eyeGestures websockets opencv-python`; `--mock` for no webcam). Serves `ws://localhost:8765/gaze` — **local-only, no DICOM sent to it**.

## Architecture (OHIF v3 monorepo)

Yarn workspaces: `platform/*`, `extensions/*`, `modes/*`, `addOns/externals/*`.

- **`platform/`** — `app/` (the viewer web app entrypoint; `src/App.tsx`, `routes/`, config in `public/config/`), `core/` (`@ohif/core`), `ui/` + `ui-next/` (component libs; ui-next is the newer Tailwind one), `i18n/`, `cli/`, `docs/`.
- **`extensions/`** — pluggable features. Upstream: `cornerstone`, `cornerstone-dicom-{seg,sr,rt,pmap}`, `default`, `measurement-tracking`, `tmtv`, … Custom: **`usAnnotation`** (ultrasound pleura/B-line).
- **`modes/`** — workflow configs combining extensions (`basic`, `longitudinal`, `segmentation`, custom `usAnnotation`, …).
- **`.scripts/`** — `eyegestures_sidecar.py`, `dev.sh`, `cs3d-*.mjs`.

**Custom fork code lives in two places:**
1. **`extensions/default/src/ViewerLayout/`** — `GazeCalibrationGate.tsx`, `HeadTrackingOverlay.tsx`, `StudyReviewPanel.tsx`, `StudyQuestionPanel.tsx`, `StudyFeedbackPage.tsx`, `SubmitFeedbackButton.tsx` + utils (`gazeHeatmapUtils`, `gazeWeighting`, `headTracking*`, `studyParams`), each with co-located `.test.ts`.
2. **`extensions/cornerstone/src/`** — `Viewport/LiveGazeHeatmapOverlay.tsx`, `utils/eyeGesturesBrowserClient.ts`, `eyeGesturesWebSocketClient.ts`, `gazeCaptureBridge.ts`, `useGazeCalibrationStatus.ts`.

**Extension pattern:** each extension exports modules (`getPanelModule`, `getCommandsModule`, `getToolbarModule`, `getViewportModule`, …) registered via an `id`; modes declare which extensions/panels/toolbar they use. Extend the `default` and `cornerstone` extensions rather than upstream-only files.

## Conventions

- **Prettier** (`.prettierrc`): single quotes, semicolons, `printWidth: 100`, `tabWidth: 2`, `trailingComma: es5`, `arrowParens: avoid`, `singleAttributePerLine: true`, `proseWrap: always`, tailwind class sorting. Enforced via lint-staged pre-commit.
- **ESLint:** `react-app` + recommended + prettier; custom rule **`curly: error`** (braces required on all control statements).
- TS: `checkJs: true`, `isolatedModules`, `emitDeclarationOnly`; path aliases in `tsconfig.json` (`@ohif/core` → `platform/core/src`, `@state`, custom `@ohif/extension-ultrasound-pleura-bline`, …). Aliases also in `aliases.config.js` / `eslintAliasesResolver.js`.
- Tests **co-located** as `*.test.ts` next to source.

## Config & env

App config is **`window.config` files in `platform/app/public/config/*.js`** (NOT env vars), selected by the `APP_CONFIG` env var.

Env (`platform/app/.env`) — only three: `PUBLIC_URL`, `APP_CONFIG` (e.g. `config/local_orthanc.js`, `config/radiologyexpertly.js`), `USE_HASH_ROUTER`.

**`radiologyexpertly.js`** (production config): default data source `radiologyExpertlyOrthanc` → `https://api-viewer.radiologyexpertly.com/orthanc/{wado,dicom-web}`, `wadors` rendering, `dicomUploadEnabled: false`. Also registers `dicomjson` + `dicomlocal`.

**Local dev** (`LOCAL_SETUP.md`): browser :3000 → OHIF dev server → nginx CORS proxy :8043 → Orthanc :8042 (DICOMweb). The nginx shim exists because Orthanc doesn't do CORS preflight; the three `*Root` URLs in `local_orthanc.js` must target :8043.

## Multi-repo context

Part of `/Users/zee/Offices/Radiology Expertly/` — the medical-image viewer front-end. Talks to the platform's **Orthanc DICOMweb backend** at `https://api-viewer.radiologyexpertly.com/orthanc/*`. Studies opened via `StudyInstanceUIDs` URL query params (`studyParams.ts`), so a host app (`-fe`/`-users`) links into it with study UIDs. The gaze/head-tracking + review/question/feedback flow supports a radiology training/assessment product. (Exact feedback/question submission endpoint isn't hardcoded in TS — check `SubmitFeedbackButton.tsx`/`StudyFeedbackPage.tsx` if you need it.) Siblings: `-be`, `-fe`, `-admin`, `-users`, `-users-be`, `-users-admin`, `-landing`.
