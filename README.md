# Comfy Toolkit

A desktop client for a ComfyUI server. Design workflows in the ComfyUI graph, export them in API format, and use this app to run them: per-shot inputs generated from the workflow, batch runs, prompt lists, a queue, a gallery, compare, keepers and sequences. See `PRD.md` for the full behaviour and `docs/decisions.md` for choices made while building.

## Run

```bash
npm install          # also rebuilds better-sqlite3 for Electron
npm run dev          # app with hot reload
npm run build && npm start
npm run dist         # installer via electron-builder (release/)
```

No GPU handy? Start the fake ComfyUI server and point the app at `http://127.0.0.1:8188`:

```bash
npm run fake-server  # PORT, FAKE_TOKEN, STEP_MS env vars; see scripts/fake-comfy.mjs for scenarios
```

Put `#fail`, `#oom`, `#reject` or `#slow` in a prompt to trigger those scenarios. `POST /_fake/other-client` queues a job from another client and `POST /_fake/offline?seconds=10` drops the connection.

## Check

```bash
npm run typecheck
npm test             # core unit tests + client integration test against the fake server
```

## Layout

```
src/core/      plain TypeScript, no Electron/React: workflow adapter (discover, schema, apply, validate,
               reconcile, server checks), run planner, prompters, output naming, ComfyUI client
src/main/      Electron main: settings, SQLite (app.db / project.db), workspace, server connection,
               job manager (queue, progress, reconcile, downloads), media protocol, IPC API
src/preload/   the explicit API exposed to the renderer
src/shared/    types and the IPC contract
src/renderer/  React UI (Zustand store, views per screen)
scripts/       fake ComfyUI server
tests/         vitest
```

Export workflows from ComfyUI with **Save (API Format)** (turn on Dev mode options first).
