# AGENTS.md

Comfy Director: an Electron desktop client that runs ComfyUI API-format workflows on a remote server (shots, batch runs, prompt lists, queue, gallery, compare, keepers, sequences).

- `docs/spec.md` is the behaviour spec and describes the app as built; `docs/wireframes/png/` is the layout reference. When a change alters behaviour, update the spec in the same change.
- `docs/decisions.md` is the log of why. Append an entry (newest last) when a choice needs its reasoning recorded. Entries up to 2026-10-08 are already folded into the spec.
- `docs/backlog.md` lists what is wanted or undecided but not built. When an item ships, write it into the spec and remove it from the backlog.

## Commands

```bash
npm install           # also rebuilds better-sqlite3 for Electron
npm run dev           # app with hot reload
npm run typecheck     # tsc for node (main/preload/core) and web (renderer) projects
npm test              # vitest: core unit tests + client integration test (spawns the fake server)
npm run fake-server   # fake ComfyUI on http://127.0.0.1:8188 (PORT, FAKE_TOKEN, STEP_MS)
npm run rebuild       # rebuild better-sqlite3 if the native module fails to load
npm run icon          # re-render resources/icon.png and icon.ico from resources/icon.svg
```

Run `npm run typecheck` and `npm test` before finishing a change. There is no linter or formatter config; match the surrounding style (2 spaces, single quotes, no semicolons, explicit return types).

For manual testing without touching real data, set `COMFY_DIRECTOR_WORKSPACE` and `COMFY_DIRECTOR_USER_DATA`. In the fake server, `#fail`, `#oom`, `#reject` or `#slow` in a prompt triggers that scenario.

## Layout

```
src/core/      Plain TypeScript, no Electron/React imports. Unit-testable.
  workflow/    discover -> schema -> apply -> validate; reconcile, server checks, overrides types
  comfy/       ComfyUI HTTP + WebSocket client
  prompter/    template, LLM and script prompt generators
  planner.ts   expands a Run into jobs; output/naming.ts for file names
src/main/      Electron main: api.ts (IPC handlers), jobs.ts (queue, progress, downloads),
               server.ts (connection, object_info cache), workspace.ts + db.ts (SQLite), settings.ts, media.ts
src/preload/   Builds window.toolkit from API_METHODS
src/shared/    types.ts and api.ts (the IPC contract)
src/renderer/  React 19 + Tailwind 4 + Zustand; views/ per screen, components/ui.tsx for primitives
scripts/       fake-comfy.mjs, make-icon.mjs
resources/     App icon (icon.svg is the source); also electron-builder's buildResources
tests/         vitest; fixtures.ts loads the example workflows in docs/
```

Import aliases: `@core`, `@shared`, and `@renderer` (renderer only).

## Conventions

- **Adding an IPC method:** add it to `ToolkitApi` and to `API_METHODS` in `src/shared/api.ts`, then implement it in `createApi` in `src/main/api.ts`. The preload and the single `api` IPC channel pick it up from the list. The renderer calls it through `api` from `@renderer/lib/api`; errors arrive as thrown `Error`s.
- **Main to renderer** goes through `emit(AppEvent)`; add new event types to `AppEvent` in `src/shared/types.ts` and handle them in `lib/store.ts`.
- **Keep `src/core` pure.** Anything touching Electron, the filesystem layout or SQLite belongs in `src/main`.
- **The workflow schema is derived on every read** from `workflow.json` + `overrides.json` + cached `object_info`; never store it. Exposed fields are matched by node class and title, never by node id.
- **Storage:** `app.db` (workspace-wide) and `project.db` (per project) are defined in `src/main/db.ts`. The access token lives only in the app data folder, never in the workspace.
- **Renderer UI:** use the components in `components/ui.tsx` and the colour tokens in `styles.css` (`bg-panel`, `text-muted`, `bg-accent`...). No shadcn CLI or Radix. Text sizes are the tokens there too (`text-13`, `text-xs`...), never `text-[13px]`, so they follow the Text size setting.
- **Local media** is shown through `ctmedia://` URLs (`media()` in `lib/api.ts`), which only serve the workspace and known project folders.
- The main process and preload build as CommonJS; `better-sqlite3` and `ws` stay external.
