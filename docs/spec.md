# Comfy Director: Spec

This document describes the app as it behaves today. A change that alters behaviour updates this file in the same change. `docs/decisions.md` is the log of why things are the way they are. Features that are planned but not built are not described here; they are listed in `docs/backlog.md`.

## Goal

The app is called **Comfy Director**. Use that name for the window title, the installer, the app data folder (`Comfy Director`), the package name (`comfy-director`) and the default output folder.

The **app icon** is a blue accent tile holding a stack of three frames (a batch of takes); the front, paper-coloured frame carries one link between two node ports (the workflow). The source is `resources/icon.svg`; `npm run icon` renders `icon.png` and `icon.ico` from it. It is used for the window, the installer, and as the logo beside the app name in the sidebar and on first launch (`Logo` in `components/ui.tsx`, the same in both themes).

A desktop app that acts as a custom client for a ComfyUI instance running on a remote server. The ComfyUI node graph is used to design workflows; this app is used to run them (batch rendering, input swapping, custom prompts, output management) without repeating manual work in the graph UI.

This document covers the stack, the architecture, how workflows are handled, local storage, and the features and screens (see "Features and UI"). Wireframes for the screens are in `docs/wireframes/`: use the PNGs for layout and this document for behavior.

## Tech Stack

| Layer | Choice |
|---|---|
| Desktop shell | Electron |
| Build/scaffold | electron-vite 4 on Vite 7 |
| UI | React 19 + Tailwind 4, with a small set of shadcn-style components in `src/renderer/src/components/ui.tsx` (no shadcn CLI or Radix) |
| Language | TypeScript 5.9 everywhere |
| State (UI) | Zustand 5 |
| Local database | SQLite via better-sqlite3 12 (main process, WAL mode) |
| ComfyUI client | `fetch` + `ws` in the main process |
| Theming | CSS variables on `:root` / `.dark` (the tokens in Theme and colours), mapped to Tailwind colours (`bg-panel`, `text-muted`, `bg-accent`...); Electron `nativeTheme.themeSource` set to `system`, `light` or `dark`, and the renderer applies the `dark` class itself |
| Packaging | electron-builder (only when an installer is wanted) |

The main process and preload build as CommonJS. Versions are pinned to majors known to work together.

Rationale: file size and performance are not concerns for this tool, so Electron wins on one-language-end-to-end (no Rust), predictable video playback (bundled Chromium), and the largest npm ecosystem.

## Architecture Model

The ComfyUI server is a pure executor. All customization happens on the desktop PC before a job is sent.

```
Desktop app (this project)                     ComfyUI server
--------------------------                     --------------
1. Load API-format workflow JSON (template)
2. Edit values in memory (prompt, seed,
   LoRA, resolution, input filenames...)
3. Upload input files  ------------------->    POST /upload/image
4. Submit final workflow  ------------------>  POST /prompt
5. Watch progress  <------------------------   WS /ws?clientId=...
6. Read result info  <----------------------   GET /history/{prompt_id}
7. Download outputs  <----------------------   GET /view
8. Rename / sort / index locally
```

### Process split (Electron)

- **Renderer (React):** UI only. Never touches the network to the server or the filesystem directly.
- **Preload:** small, explicit API that exposes main-process functions to the UI.
- **Main process:** ComfyUI client (HTTP + WebSocket), file I/O, SQLite.

### Core modules

Written as plain TypeScript in `src/core` with no Electron or React imports, so they can be reused from a CLI or another shell later:

1. **Workflow:** discovers the inputs of an API-format JSON, builds the schema from them plus `overrides.json` and `object_info`, applies a values map to a copy of the workflow, and validates the result. Also reconciles a new version against the old one and checks a workflow against the server.
2. **ComfyUI client:** the HTTP and WebSocket calls in "ComfyUI API Endpoints Used".
3. **Run planner:** expands the prompt list and the runs count into a list of jobs (one attempt each).
4. **Prompter:** produces prompt text. Template, LLM and script prompters share one interface. An LLM prompter can carry a prompting skill and also answers a shot's Prompt chat.
5. **Output naming:** pure functions for output folders and file names.

Everything that touches Electron, the filesystem layout or SQLite is in `src/main`: the job queue with progress and downloads, the server connection, the workspace and the databases.

## Key Facts About ComfyUI to Design Around

- **Two workflow formats.** The graph UI saves *UI format* on the server (`user/default/workflows/`), which cannot be sent to `/prompt`. Execution requires *API format* (flat `node_id` to `{class_type, inputs}`), exported via **Save (API Format)** (needs Dev mode options on).
- **The app stores its own API-format workflows** (imported by the user, kept locally). After changing a workflow in the graph, the user re-exports and re-imports it. An API-format prompt can also be recovered from `GET /history/{prompt_id}` or from PNG output metadata.
- **File inputs are filenames, not data.** Images/videos must be uploaded to the server first; the JSON then references the returned filename.
- **Models are resolved on the server.** Checkpoint/LoRA/etc. names must match files on the server. `GET /object_info` lists valid options.
- **Node IDs change when a workflow is re-exported.** Inputs are matched by node class and `_meta.title`, never by node id.
- **Caching.** Identical workflow plus identical inputs (including the seed) may be served from ComfyUI's cache without re-rendering.
- **No built-in auth.** If the server is reachable beyond a trusted network, put it behind a reverse proxy with a token or a VPN.
- **Custom nodes** used by a workflow must be installed on the server, not on the desktop.

## Workflow Handling

Workflows will change over time (inputs added, removed, renamed), and different workflows expose different inputs (e.g. fl2vid vs ref2vid). The app therefore treats the exported workflow as the source of truth and **generates the input UI from it**, rather than hardcoding a screen per workflow.

Reference workflows used for design (all MiniMax H3):

| File | What it is | Notes |
|---|---|---|
| `video_minimax_h3_r2v.json` | Reference-to-video (ref2vid): 4 ref images, 1 ref video, 1 ref audio | Flat node ids. Prompt comes from an `Input Text (Prompt)` node. The video goes through a `Get Video Components` node, which feeds both `ref_videos.ref_video_0` (frames) and `ref_video_audios.ref_video_audio_0` (its audio track). |
| `video_minimax_h3_i2v_continuation.json` | First and last frame to video (fl2vid) | Node ids carry a subgraph prefix (`105:...`). Prompt is typed directly on the `MiniMaxH3ImageToVideo` node. Two `LoadImage` nodes, both titled "Load Image". |
| `video_minimax_h3_t2v.json` | Text to video (t2v) | Identical to fl2vid except: no `LoadImage` nodes, no `first_frame` / `last_frame` links, different default values, and subgraph prefix `140:`. |

What these three files teach (each rule is written into the sections below):

- Node ids are not stable: the same workflow exports with no prefix, `105:` or `140:`. Ids must be treated as opaque strings and never parsed or sorted as numbers.
- Titles are not consistent across workflows either (`Float (Duration)` vs `Float (duration)`, `If/Else Switch (Model)` vs `(model)`). Input keys therefore need a derivation rule (see Input keys).
- The prompt is not always an input node. In fl2vid and t2v it is a field on a regular node, which auto-discovery picks up (see Three layers).
- t2v is fl2vid with both images left out, so optional file inputs (below) cover t2v, i2v (first frame only) and fl2v in one workflow.

### Schema vs values

- **Schema:** derived from a workflow. A list of inputs, each with `{key, type, label, constraints, default, where it writes in the JSON}`.
- **Values:** a flat `{key: value}` map per shot and per attempt.
- The UI renders the schema using one small component per input type (text, number, toggle, select, file, file-group). A new input kind means adding one component, not a new screen.
- The run planner and history only handle `{workflow, values}`, so a workflow changing shape does not ripple through the app.

### Three layers

1. **Auto-discovery on import.** Scan the API JSON for obvious input nodes:
   - `PrimitiveStringMultiline`, `PrimitiveInt`, `PrimitiveFloat`, `PrimitiveBoolean` become text, number and toggle controls. Label from `_meta.title`, default from the current value.
   - `LoadImage`, `LoadVideo` and `LoadAudio` become file inputs for an image, a video and an audio file.
   - Several loader nodes feeding one dotted input group on a single node (e.g. `ref_images.ref_image_0..N`) become one **file-group** control with add/remove.
   - A loader whose consumer is a `GetVideoComponents` node is looked at through that node: the input is what the unpack node feeds. Its other links into the same consumer node (the video's audio track) belong to the same input, so one video file fills both.
   - A literal text `prompt` field on a regular node (`MiniMaxH3ImageToVideo.prompt` in fl2vid and t2v) becomes a text input.
   - The `aspect_ratio` and `megapixels` fields of a `ResolutionSelector` node become a dropdown and a number input, so every workflow sized by that node offers the same two controls and their values carry over between workflows.
   - Literal `seed` / `noise_seed` integer fields are found and always driven by the shot's Seed control (see Seed). They are not listed as inputs.
   - Dropdown options and ranges come from `GET /object_info`. The last response is cached in the app data folder, so schemas work offline.
   - A primitive whose every consumer is the `on_true` / `on_false` input of a switch node is "internal" and starts unticked on import (the two Steps values in the reference workflows).
   - Note: the old frontend-only "Primitive" node disappears at export (its value is baked into the target node), so workflows using it need the override layer. The newer `Primitive*` nodes remain real nodes and are discoverable.
2. **Overrides (optional sidecar).** Holds exceptions only: exposing a field on a regular node (e.g. `KSampler.cfg`), hiding a discovered input, renaming, a different default, ordering, min/max. Most workflows need little or nothing here. The format of `overrides.json`:

   ```
   {
     inputs: { <candidate id>: { hidden, key, label, help, default, order, min, max, step, minCount, maxCount } },
     expose: [ { class, title?, field, key?, label?, help?, default?, order?, min?, max?, step? } ]
   }
   ```

   The candidate id is the derived key (see Input keys). Exposed fields are matched by node class and normalised title.

   An input's default is the value in the workflow file unless `default` is set here. The default is what a shot uses for an input it has no value of its own for, so changing it changes those shots too. Each attempt records the defaults it ran with, so past attempts are not affected. File inputs have no default.
3. **Reconcile on re-import.** Diff the new schema against the old one using a stable key (node title, not node ID):
   - New input: appears in the UI with its default.
   - Removed input: disappears; saved values referencing it produce a warning, not a crash.
   - Matching input: keeps saved values.

The schema is derived on every read from `workflow.json`, `overrides.json` and the cached `object_info`. It is never stored.

### Convention in the node graph

Give every control node a clear, unique `_meta.title` (e.g. `Input Text (Prompt)`, `Float (Duration)`, `Boolean (Enable Lightning LoRA)`). Node IDs change on re-export; titles are the stable key. Repeated titles (such as several `Load Image` nodes) are resolved by following links from the consuming node instead (see Input keys). Titles are matched after the normalisation in Input keys, so a difference in capitals is harmless, but a different word is a different input.

### Input keys

Values are matched across workflows and across re-imports by key, so keys must come out the same for the same thing:

- **Primitive input nodes:** the text inside the parentheses of the title if there is one, otherwise the whole title, lowercased and trimmed. `Float (Duration)` and `Float (duration)` both give `duration`. `Input Text (Prompt)` gives `prompt`. `Boolean (Enable Lightning LoRA)` gives `enable lightning lora`.
- **Fields on regular nodes (discovered, or exposed through overrides):** the field name, for example `prompt`, `aspect_ratio`, `megapixels`, `cfg`. The same field on the same node class in two workflows gives the same key, so a typed-in prompt on `MiniMaxH3ImageToVideo` shares its value with the `Input Text (Prompt)` node in ref2vid.
- **File inputs:** the name of the consumer input they feed (`first_frame`, `last_frame`), because `LoadImage` nodes are normally left as "Load Image". A file group uses the group prefix (`ref_images`, `ref_videos`, `ref_audios`), not the slot names.
- **Repeated keys:** when two inputs in one workflow derive the same key (two nodes titled `Int`), each gets a unique key automatically: the label if the user renamed it (`full-steps`), otherwise the key numbered in workflow order (`int`, `int#2`, `int#3`). On import, keys resolved this way are written to `overrides.json` as an explicit `"key"`, so renaming a label later only changes the text in the form and the key that shots store values under stays fixed.
- An override can always set an explicit key. Two explicitly typed keys that clash are flagged on the Import screen.

### Optional file inputs (first and last frame, text-to-video)

- On import, `GET /object_info` tells which inputs of the consumer node are optional. A loader (`LoadImage`, `LoadVideo`, `LoadAudio`) feeding an **optional** input is an optional file input. One feeding a required input is required. Without server info the input is treated as optional, and the server reports it at Run if it is not.
- **File inputs start empty**, not with the filename baked into the export (that file lives only on the server).
- **Empty optional input:** before sending, the app deletes that loader node, its unpack node if it has one, and the links on the consumer node. The result is a valid workflow that simply has no file there. This is the same mechanism as unused ref slots.
- **Required input empty:** Run is blocked with a message on that field.
- In `MiniMaxH3ImageToVideo`, `first_frame` and `last_frame` are optional. With both empty the result matches `video_minimax_h3_t2v.json` (checked by comparing the two files). With only a first frame it is image-to-video. Both cases were run on the real server (2026-10-08).
- Because of this, importing only the fl2vid file covers t2v, i2v and fl2v. Importing the t2v file as well is optional: it is the same graph with different defaults (16:9, 1 megapixel, 5 s, turbo off), so it would only add a tab.

### Variable-count inputs (ref images, videos and audio)

- Ref slots are not a list. Each is a separate key on the consumer node (`ref_images.ref_image_N`) linking to its own `LoadImage` node.
- To use fewer images: keep only the first N slots, delete the other keys and their unused `LoadImage` nodes, and set each remaining loader's filename to the uploaded file.
- To use more: the app clones the first `LoadImage` node under the next free integer id and adds the next slot key.
- Reference videos (`ref_videos.ref_video_N`) and reference audio (`ref_audios.ref_audio_N`) are groups of the same kind, loaded by `LoadVideo` and `LoadAudio`. Each video slot is a `LoadVideo` plus its own `Get Video Components` node, and also fills the matching `ref_video_audios.ref_video_audio_N` slot from that node's audio output. Adding a video clones both nodes; removing one deletes both nodes and both slot keys. `ref_video_audios` is therefore not an input of its own.
- With no video or audio added, those nodes and slots are all removed, so the workflow runs on images alone.
- Slot indices stay contiguous (0, 1, 2, ...).
- Slot order is defined by the links on the consumer node, not by node ID order.
- Min and max counts come from `GET /object_info` (a numeric `min` / `max` in the input's options, or the length of a `names` list). Without it, the minimum is 1 if the input is required and the maximum is the number of slots in the export. `minCount` / `maxCount` in the overrides replace them.

### Toggles that change several things (turbo / Lightning LoRA)

In the reference workflow, a single boolean node drives two switch nodes: one selects the LoRA'd vs base model, the other selects 4 vs 20 steps. So the toggle is one value (`PrimitiveBoolean.value`) and the graph handles the rest. Prefer this pattern over editing or removing nodes from the app. If a workflow lacks such a switch, the fallbacks are setting LoRA strength to 0 or keeping two exported templates.

### Seed

API format has no "randomize after run". The app writes the seed into every literal `seed` / `noise_seed` field and generates a new one per job when the shot's Seed control is on Random (random seeds are below 2^48). Identical workflow, inputs and seed may be served from ComfyUI's cache instead of re-rendering.

### Inputs left baked in

Model, VAE and CLIP names, sampler, scheduler, and LoRA strength stay as set in the graph. In the reference workflow, fps appears in both the video node and the frame-count math, so it is not exposed.

## Local Storage

The ComfyUI API-format JSON is used as the workflow file itself. No custom workflow format.

### Principles

- **Keep `workflow.json` untouched.** It is the exported file as-is. Re-exporting after a graph change simply overwrites it, with nothing to merge.
- **Stay portable.** The file can be loaded back into ComfyUI, shared, or run by other tools.
- **Never add custom keys to the workflow JSON.** ComfyUI treats every top-level key in the prompt as a node, so extra metadata would fail validation.
- **App-specific data lives beside it,** not inside it.
- **The schema is not stored.** It is derived on every read (see Three layers).

### Layout

One **workspace folder** (default `~/Comfy Director/`, set in Settings) holds app-wide data and a folder per project:

```
Comfy Director/                     workspace
  workflows/                       app-wide
    minimax_h3_r2v/
      workflow.json                exported API-format file, untouched
      overrides.json               optional, exceptions only
      versions/1/                  earlier versions, kept when a new one is imported
    minimax_h3_fl2v/
      workflow.json
  prompter/
    skills/
      minimax_h3/                  one folder per workflow type
        skill.md                   prompting guide, sent whole to the LLM
  app.db                           app-wide SQLite: prompt library, prompters, workflow index
  .gitignore                       excludes app.db and projects/
  projects/
    Rooftop short/                 one folder per project (folder name = project name)
      project.db                   project SQLite: sequences, shots, attempts, keepers
      inputs/                      copies of images chosen in this project
      thumbs/                      one still frame per attempt
      outputs/
        Rooftop chase/
          03 Roof edge/
            attempt-6-ref2vid.mp4
        _loose/
        _keepers/
    Client teaser/
```

- **App-wide** (`workflows/`, `prompter/`, `app.db`): things shared by every project. Workflows and prompting skills are plain files so they can be hand-edited and versioned with git. The prompt library and prompters are shared so they can be reused across projects.
- **Project-wide** (`projects/<name>/`): everything that belongs to one body of work. A project can be renamed, moved, archived or backed up as one folder. Each attempt keeps the exact final JSON that was sent (see Reproducibility), so a project still makes sense on a machine that lacks the original workflow files.
- **Paths inside `project.db` are relative to the project folder.** Renaming the project renames the folder and nothing else changes.
- **Plain files** for things worth hand-editing (workflows, overrides). **SQLite** for things that grow and need querying (history, keepers, prompt library).
- **Not in the workspace**, but in the app's data folder:
  - `settings.json`: server address, workspace path, theme, text size, current project, and the ComfyUI `clientId`. The client id is generated once and kept, so progress events for jobs queued before a restart still reach the app.
  - `token.bin`: the access token, encrypted with Electron `safeStorage` (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux). If no OS encryption is available it is stored as plain bytes there. Sharing a workspace never shares the token.
  - The cached `object_info`.
  - `window.json`: the window's size, position and maximized state, saved when the window closes and restored on the next launch. A saved position that is no longer on any connected display is dropped and the window is centred at its saved size. The first launch opens at 1440 x 940.
- The app writes a `.gitignore` into a new workspace that excludes `app.db` and `projects/`, so `workflows/` can be versioned on its own.
- **Do not place the workspace in a synced folder** (Dropbox, iCloud, OneDrive): SQLite files can be corrupted. Settings shows a warning.
- **Hand-edited workflows.** If `workflow.json` changes on disk without an import, the next read records it as a new version (new hash). Folders found in `workflows/` but missing from `app.db` (for example after a git clone) are indexed automatically. A `workflow.json` that is not valid JSON is skipped in the workflow list.
- `COMFY_DIRECTOR_WORKSPACE` and `COMFY_DIRECTOR_USER_DATA` override the workspace and app data folders (used for testing).

### Databases

Both are SQLite in WAL mode, defined in `src/main/db.ts`.

- `app.db`: `meta`, `workflows`, `workflow_versions`, `projects`, `prompts`, `prompters`.
- `project.db`: `meta`, `sequences`, `shots` (values JSON, prompt list, seed mode, runs, keeper, next attempt number), `attempts` (values, seed, status, prompt id, server URL, run id and indices, final JSON, outputs JSON, thumb, duration, error JSON, timestamps), `inputs`, `uploads`, `chat_messages` (shot, role, text, attached image names; deleted with the shot).

### Input files

- When the user picks a file for a file input (PNG, JPG, WEBP or BMP image; MP4, MOV or WEBM video; WAV, MP3, FLAC, OGG or M4A audio), the app **copies it into the project's `inputs/`** as `<first 20 hex of sha256>.<ext>` (original name kept in the database for display). The project therefore does not depend on the original file staying where it was.
- On Run, the file is uploaded to the server under its hash name (`overwrite=true`), so two different pictures never collide. Uploads are remembered per server in `project.db`, so the same picture is uploaded once per server.
- If the server rejects a Run on a file input whose upload the app had skipped as remembered, the app forgets those uploads, uploads again and posts the Run a second time. A second rejection is shown as usual. This covers a server whose input folder was emptied.

### Reproducibility

- Each import stores a timestamp and a hash of `workflow.json`, and every attempt records which version it ran.
- Each attempt keeps its values map, its seed and the exact final JSON that was sent, so an old render can be re-run or tweaked later.

## Features and UI

Wireframes: `docs/wireframes/png/01` to `15` (see `docs/wireframes/README.md`). The wireframes show layout and structure only; behavior is defined here. Where they disagree, this document wins.

### Core concepts

| Concept | Definition |
|---|---|
| **Workflow** | An imported API-format JSON, its derived schema, and optional overrides. Versioned: each import stores a timestamp and hash. |
| **Project** | A folder of related work: sequences, loose shots, their renders and input images. Every shot belongs to exactly one project. Workflows, prompts, prompters and settings are shared by all projects. |
| **Shot** | One moment of a video that the user is working on. Holds a name, an optional sequence and position, the active workflow, a values map, a list of attempts, and at most one keeper. |
| **Sequence** | A named, ordered list of shots inside a project. |
| **Loose shot** | A shot that belongs to a project but to no sequence. Listed under "Loose shots" in the sidebar. |
| **Attempt** | One render. Stores the shot, the workflow and its version hash, the full values map, the seed, status, `prompt_id`, output files, and timestamps. Also keeps the exact final JSON that was sent (see Local Storage > Reproducibility). The `#N` shown in the UI is numbered per shot; the database id is unique in the project and is the one used in file names. |
| **Keeper** | The attempt the user chose as the result for a shot. At most one per shot. |
| **Run** | One click of the Run button. It creates one attempt per prompt per run (prompts x runs) and queues them all at once. |

Rules:

- **Values belong to the shot, not the workflow.** Values are keyed by input key. Switching the active workflow keeps every value whose key exists in the new workflow's schema. Values for keys the new workflow does not have are kept but hidden, and come back if the user switches back.
- **A shot's workflow is a per-attempt choice.** Attempts in one shot can use different workflows (e.g. to compare ref2vid and fl2vid on the same content).
- **Setting a keeper** replaces the previous keeper. Deleting the keeper attempt clears the keeper (with a confirmation).
- **Deleting** a shot, a sequence or an attempt removes records only. Rendered files stay in the project folder. Running and queued attempts must be cancelled first.
- **Shared vs other inputs:** inputs whose key exists in every imported workflow are shown first; the active workflow's remaining inputs are shown below an "OTHER INPUTS" divider. These may still exist in some of the other workflows, just not all of them.

### App shell (on every screen)

- **Sidebar:**
  - Logo and app name (Comfy Director), and server status (dot plus server name; "connected" or offline).
  - **Project switcher** under the app name: the current project with a menu (see Projects). Everything below it belongs to that project.
  - **Sequences:** a **+** button in the header row creates a new sequence (see Projects). Each sequence expands to its shots, one row per shot (`NN Name`). A filled dot means the shot has a keeper, a ring means none yet. The current shot is highlighted.
  - **Loose shots:** same rows, no numbering. A **+** button in the header row creates a new loose shot (New shot dialog, preset to Loose shot).
  - **Dragging a shot row** moves the shot, the same as Move to sequence in the Shot view. Dropped on a sequence's name it goes to the end of that sequence (which then expands); dropped on a shot in a sequence it goes to that shot's position (a line shows where it lands), which also reorders shots within one sequence; dropped anywhere on the Loose shots section it becomes a loose shot. The target is outlined while a shot is held over it. Loose shots have no order, so they cannot be rearranged among themselves.
  - Links to **Gallery**, **Library** and **Settings**.
  - **Theme switch** at the bottom: Auto / Light / Dark (see Theme and colours).
- **Queue strip** (bottom of every screen): currently running job (shot name, percent), a progress bar, count of waiting jobs, and an arrow showing whether the Queue drawer (wireframe 06) is open. Clicking anywhere on the strip opens or closes the drawer; there is no separate button. When nothing is queued it reads "Idle".
- **Connection banner** at the top of every screen when the server cannot be reached (see States).
- The sidebar's Sequences, Loose shots, the Gallery and Compare show the current project. The queue strip and Queue drawer show jobs from every project, each labelled with its project when it is not the current one.
- Clicking a sequence name opens the Sequence view. Clicking a shot opens the Shot view.

### Shot view (wireframes 01, 02)

Purpose: set up inputs for one shot, run attempts, and review them. This is the main screen.

- **Header:** breadcrumb (sequence, shot number, keeper id, attempt count), editable shot name, and these actions:
  - **Duplicate shot:** new shot with the same workflow and values, no attempts, placed after the original (or loose, if the original is loose).
  - **Move to sequence:** moves the shot to a sequence at a chosen position, or to Loose shots.
  - **Delete shot:** asks first, then removes the shot and its attempt records and opens the neighbouring shot.
- **Workflow tabs:** one tab per imported workflow plus "+ Import workflow" (opens the Import view). Switching tabs follows the values rules above. **Edit workflow** opens the Import screen on the active workflow (see Import workflow).
- **Input form:** generated from the active workflow's schema (see Workflow Handling), one component per input type:

  | Input type | Control |
  |---|---|
  | text | Multi-line text box |
  | number | Number field (with min/max/step from the schema or overrides) |
  | toggle | Checkbox with label and short help text |
  | select | Dropdown; options from `GET /object_info` |
  | file | One slot with Replace, showing the image, the video (plays muted while hovered) or a play button for audio. An optional file input can be empty and shows "Add" and, when filled, "Remove"; a hint says what an empty slot means (for example "Leave both frames empty for text-to-video") |
  | file group | Slots as thumbnails with remove (x), add (+), drag to reorder, a "n of max slots" count, and a **Clear** button that empties the whole group (disabled while the group is empty). Slots are numbered "ref N" for images, "video N" and "audio N", the way a prompt refers to them |

  A file group control enforces the minimum and maximum slot counts from the schema. Unused slots are removed from the workflow before sending (see Variable-count inputs).
- **Prompt: "single" / "list" toggle.** Only the prompt can be switched to list mode (see Prompt list mode below). Every other input stays a single value. To try another duration, aspect ratio, turbo setting, workflow or set of reference images, change it and press Run again: the queue holds the jobs, and Compare shows what differs. There is no separate batch screen and no lists for numbers or choices. A **Save to Library** link on the prompt box stores the prompt in the Library.
- **Seed:** a segmented control **Random / Fixed**. Hidden for workflows without a seed field.
  - Random: a new seed per job, generated by the app.
  - Fixed: the entered value is used for every job. Repeating a run with identical inputs and a fixed seed is answered from the server's cache (see Attempt states).
  - The field shows the last seed used (read-only while Random).
- **Runs box** (next to Run): how many attempts to make from the current inputs, default 1. With Random seed each run gets a new seed. In prompt list mode it is "Runs per prompt".
- **Run button:** reads "Run N jobs", where N = prompts x runs. It validates inputs (required files present, counts within bounds), uploads any input files not yet on the server, creates the attempts, and queues them all at once. If anything fails before queueing, nothing is queued (see States). Disabled while the server is offline.
- **Prompt chat panel** (optional, between the form and the Attempts panel): see Prompt chat below.
- **Attempts panel** (right side), newest first. Each card shows:
  - Preview thumbnail with play (while running: percent instead). Double-clicking a finished card anywhere outside its buttons and checkbox also opens the player.
  - Attempt id, workflow chip, and a KEEPER tag on the keeper.
  - A one-line summary (turbo or full, duration, seed, age) and a compare checkbox. Clicking a finished card anywhere outside its buttons ticks or unticks it too, and ticked cards are tinted.
  - Actions: **Load settings**, **Set keeper**, **Delete**, and while running a progress bar with **Cancel**.
  - **Load settings** copies this attempt's workflow and values into the form and puts its seed in the seed field without changing Random/Fixed. If the attempt came from a list run, the Prompt row switches to single with that prompt.
  - One compare button opens the Compare view (wireframe 09). With nothing ticked it reads "Compare latest" and compares the newest 2 to 4 finished attempts (disabled with fewer than 2). With attempts ticked it reads "Compare selected" and compares the 2 to 4 ticked ones. "Show older attempts" loads the rest of the list.
  - Failed, cancelled and cached attempts have their own card states (see Attempt states).

### Sequence view (wireframe 03)

Purpose: see the shots of a sequence in order, each represented by its keeper, and jump into any shot to revise it.

- **Header:** sequence name, counts ("4 shots, 3 keepers"), **Add shot** (opens the New shot dialog preset to this sequence), **Delete shot** (see below), **Play keepers in order**, **Export keepers** (see Output rules), and **Delete sequence**. Delete sequence asks first: **Keep shots** (they become loose shots), **Delete shots too** (removes them and their attempt records; rendered files stay in the project folder) or Cancel. An empty sequence gets a plain confirmation.
- **Shot cards**, in sequence order, drag to reorder (grip handle). Each card shows:
  - Number and name.
  - The keeper preview with play, or an empty state ("No keeper yet, 0 attempts") with a "Start shot" button.
  - Workflow chip, duration, and attempt count.
  - **Open shot**, which goes to the Shot view.
- **Selecting and deleting shots:** a click on a card (outside its buttons) selects or deselects it; any number can be selected. **Delete shot** in the header, or the Del key, asks first, then removes the selected shots and their attempt records (rendered files stay in the project folder) and renumbers the rest. The button is off with nothing selected; Del is ignored while typing in a field or while a dialog is open.
- **Add shot tile** at the end of the row (same as the header button).
- **Keeper timeline:** one segment per shot, width proportional to the keeper's duration, with a dashed segment for shots without a keeper, and the total length of the keepers so far.
- **Play keepers in order:** plays the keepers one after another as a preview, skipping shots without a keeper. It does not stitch or export a video.

### Gallery (wireframe 04)

Purpose: find any render across all sequences and loose shots.

- **Filters:** project (default the current project, or All projects), search in prompt text, workflow, sequence (including "Loose shots"), and "Keepers only". **Group by:** Shot (default) or Time.
- **Groups:** a header per shot ("Sequence / NN Name, n attempts") followed by a grid of thumbnails, each with id, workflow, and KEEPER tag where it applies. The grid loads 60 renders at a time as the user scrolls, with lazy thumbnails. Clicking a thumbnail selects it; double-clicking it opens the player.
- **Detail panel** for the selected render: large preview, summary of its values (workflow, duration, turbo, aspect, seed, number of refs, prompt start) and, for a finished render, its **render time** (execution start to finish), and actions:
  - **Load into shot:** opens the Shot view for that attempt's shot with the attempt's workflow and values loaded.
  - **Reveal file:** shows the output file in the operating system's file manager.

### Import workflow (wireframe 05)

Purpose: add a workflow, or replace an existing one with a new version, and decide which inputs to expose. Four steps on one screen:

1. **Choose the file.** Drop or browse for an API-format `.json`. The file is validated: a file in UI format is rejected with a message that explains Save (API Format). Shows file name, "API format" badge, node count, and node-type count. Then:
   - **Workflow name** (default from the file name).
   - Either **replace the existing workflow with a new version**, or **save as a separate workflow**.
2. **Choose which inputs to expose.** A table of auto-discovered inputs (see Workflow Handling > Three layers): a checkbox to expose, an editable label, the input type, the node it comes from, and its default. The default can be edited for text, number, dropdown and toggle inputs (saved to the overrides file); **Reset to graph value** goes back to the value in the workflow file. Primitives, a discovered prompt field and the `ResolutionSelector` aspect ratio and megapixels start checked, except primitives that only feed internal switches (the two "Steps" values), which start unchecked. Below it, **Not found automatically**: other fields on regular nodes with an **Expose** button, which adds an entry to the overrides file. The suggested fields are `prompt`, `text`, `negative` / `negative_prompt`, `aspect_ratio`, `megapixels`, `width`, `height`, `steps`, `cfg`, `length`, `duration`, `num_frames`, `batch_size`, and any multiline string; **Show all fields** lists every literal field. Seed fields are not offered, because the Seed control drives them.
3. **Checked against the server.** Using `GET /object_info`: every node type is installed, every model file referenced exists, every link points to an existing node. Missing node types or models are shown as warnings and do not block the import. Invalid files (step 1) and broken links block it.
4. **What changes.** A diff against the current version, grouped as NEW, CHANGED, REMOVED, and SAME inputs, matched by node title. For removed inputs, shows how many saved shots use them: they keep the stored value, but the field is no longer shown or sent. A note states that past attempts keep the exact version they ran with.

**Import as version N** stores the new `workflow.json`, the hash and timestamp, and the updated overrides. The previous version is kept in `workflows/<id>/versions/<N>/` so attempts can still reference it. Cancel returns to the previous screen.

**Edit workflow** (from Settings, or from a shot) reuses this screen on the stored file. It changes the name and `overrides.json` only, so the version and hash stay the same. To update the graph, import the new export and choose Replace.

**Delete** (in Settings) asks first, then moves `workflows/<id>/` to the system trash and drops it from the index. Its version records stay, so a later import under the same id continues the numbering. Shots that used it fall back to the first workflow; attempts keep their record and their files.

### Prompt list mode (wireframe 12)

Purpose: render many prompts for one shot in a single Run. This is the only batch feature besides the Runs box.

- Switching the Prompt row to **list** replaces the prompt box with a list of editable prompts. The rest of the form stays where it is, and every prompt uses its current values. **single** switches back (the list is kept).
- **Prompter row** ("Fill the list with a prompter"): a dropdown of Library prompters, **Prompts to write**, a choice of **Replace list / Add to list**, **Generate**, and an **Edit prompter** link to the Library. A line under the row says what Generate will do with the chosen prompter. Generated prompts are plain text. Nothing is re-rolled unless Generate is pressed again.
  - **Prompts to write** is how many prompts one press of Generate produces. It is unrelated to how many boxes the list already has: the results replace the list or are appended to it.
  - Template and script prompters generate at once ("Generate 6").
  - An LLM prompter shows a **From** switch, **Many ideas / One idea, variations**. It starts on the input saved with the prompter and can be changed here for this shot view without changing the prompter.
  - An LLM prompter always asks for its input first ("Generate…"). With Many ideas (the prompter's "one idea per line") a dialog takes shot descriptions, one per line, and writes one prompt each; Prompts to write is hidden because the lines decide the count. With One idea, variations ("the current shot prompt") a dialog shows the shot's single-mode prompt, editable, and writes that many variations of it; it cannot be sent empty. No images are sent either way; the Prompt chat is the place for that.
- **List:** a count line ("3 prompts in the list. Each one is rendered as its own job; empty boxes are skipped.") and one text box per prompt with Remove. Each box grows to fit its text, as does the single-mode prompt box. Dropping a text file on a list box or on the single-mode prompt box replaces that box's text with the file's contents (several files are joined with a blank line); a file over 1 MB or one that is not text is refused with a message. Below: **Add prompt**, **Paste lines** (one prompt per line), **Pick from Library**.
- **Run bar:** "Runs per prompt" box and "Run N jobs", with the line "6 prompts x 2 runs = 12 jobs". Each job becomes an attempt in the shot. All are sent to the server at once and run in the server's own order. In the Queue drawer they appear as one group.

### Prompt chat

Purpose: work out one shot's prompt with an LLM, back and forth: describe the shot, get a prompt, render it, come back and say what to change. One conversation per shot, kept in `project.db`.

- **Where:** its own panel in the Shot view, between the form and the Attempts panel, so the prompt box it writes into and the attempts it is about are both visible. It is open by default. The panel's × closes it and an **Open prompt chat** button on the Prompt row brings it back; the app remembers the choice while it runs. While it is open the Attempts panel is narrower (380 px instead of 460). The panel fills the window height, stays in place while the page scrolls, and scrolls inside. Workflows without a prompt input have no chat.
- **Prompter:** a dropdown of the Library's LLM prompters, each shown with its skill's workflow type. The default is the prompter whose skill type equals the active workflow's id or starts it (`minimax_h3` for `minimax_h3_r2v`; `-` and `_` count as the same), else the one used last, else the first. With no LLM prompter the panel links to the Library. The prompter can be changed mid-conversation.
- **Composer:** a text box (Enter sends, Shift+Enter is a new line) and:
  - **Add images** (file dialog) and dropping image files on the composer. Images are copied into the project's `inputs/` like any input image.
  - **Shot's images (n):** attaches the images in the shot's form, in the workflow's order (file inputs and reference slots). Videos and audio files in the form are left out.
  - **Quote prompt:** pastes the shot's current prompt into the message as a fenced block.
  - Attached images show as thumbnails labelled **Image N**. N counts across the whole chat, and the LLM is told the same numbers.
- **What is sent:** every Send posts the whole conversation to `POST {endpoint}/chat/completions`. The system message is the prompter's skill file in full (read from disk each time), then its instruction, then a fixed rule: put each proposed prompt in its own fenced code block and keep explanations outside it. Images go as `image_url` data URLs before the message's text, each preceded by its "Image N" label; PNG and JPEG larger than 1568 px on the long side are scaled down to that as JPEG. The model must accept images for attachments to work. Nothing is sent to the ComfyUI server.
- **Messages are rendered as Markdown** (GitHub flavour: headings, lists, tables, bold, inline code), on both sides. A single line break stays a line break. Raw HTML is shown as text, pictures linked in a reply are not fetched (their alt text is shown), and links open in the system browser.
- **Replies** are shown whole. Each fenced block is a prompt card with **Use as prompt** (replaces the shot's prompt; in list mode it reads **Add to prompt list** and appends) and **Copy**. The reply is streamed (`stream: true`): it appears as it is written, with **Stop** beside "Writing…". Stop keeps what has arrived as the reply; stopped before anything arrived, the message stays waiting and can be sent again with **Try again**. The prompt cards get their buttons when the reply is complete. An endpoint that ignores `stream` and answers in one piece works too.
- **Failure:** the user's message is kept, the endpoint's error is shown under it, and **Try again** asks for the reply again. A reply that breaks off part-way is not saved.
- **Clear chat** deletes the shot's messages after a confirmation. Attached images stay in `inputs/`. Duplicating a shot does not copy its chat; deleting a shot deletes it.

### Queue drawer (wireframe 06)

Purpose: see and cancel what the server is running. The app does not reorder jobs: **the queue order is ComfyUI's own (first in, first out).**

- Opened by clicking the queue strip. Clicking the strip again, or anywhere on the drawer's header other than **Cancel all waiting**, closes it; there is no separate Collapse button. The drawer rises out of the strip when it opens (170 ms) and sinks back when it closes (120 ms); with the system's reduced-motion setting on it appears and disappears at once.
- **Header:** "1 running, 10 waiting", the note that the server runs jobs in the order it received them, and **Cancel all waiting (n)**. n counts only jobs started from this app. Jobs started from other clients are never cancelled in bulk.
- **Running:** shot name, attempt id, workflow chip, a progress bar with percent, the current stage ("Sampling, step 3 of 4"), elapsed time, and **Interrupt**. Interrupt follows the Interrupt rule below.
- **Waiting:** in server order, with a position number (Next, 2, 3, ...).
  - Jobs from one Run are grouped under a header (shot, workflow, "5 prompts x 1 seed", range of positions) with **Cancel remaining (n)**. Groups collapse and expand.
  - Each job shows shot, attempt id, workflow chip, and a note (for example "prompt 2 of 5, seed random"), with **Cancel**.
  - Jobs from other clients show "Started from another client" and a prompt id. Cancelling one asks first.
- **Finished recently:** this session only (the last 50, kept in memory). Each row shows a tag (DONE, CACHED, FAILED, CANCELLED), shot, id, workflow, a note (age, render time or reason), and **Open shot** or **Details** (for failures). Older attempts live in the shot and in the Gallery.
- **Not included:** reordering, pausing, and priorities. ComfyUI has none of these, and the app does not simulate them.
- **Launch and reconnect:** the app compares its running attempts with `GET /queue` and `GET /history` and updates their states (see States).

### Attempt states (wireframe 07, section 5)

Attempt cards in the Shot view say what happened and offer the next step. Under the workflow chip, a line of its own shows the full seed ("seed 123456788825"), then the summary line reads, for example, "turbo · 8 steps · 10 s · 0.4 MP": the settings the attempt was queued with. Turbo or full, duration and megapixels come from its stored values; **steps** is the count the submitted graph runs, worked out when the attempt is queued by following the sampler's `steps` input through value nodes and switches (so the turbo toggle picks the right branch) and stored with the attempt (`steps`; attempts from before it was added are filled in from their stored graph when the project opens). Each part is left out when the workflow has no such setting.

- **Running:** a second line under the summary shows the stage and a live elapsed time since the server started the job ("Sampling · 1 min 12 s"), updating every second.
- **Done:** the second line under the summary reads "3 min ago · rendered in 2 min 5 s", the server's own execution time (the `execution_start` and `execution_success` timestamps in `GET /history`, so queue wait and download are excluded and a job that finished while the app was closed still has it). If the server's history lacks those timestamps, the app's own stopwatch from the moment it saw the job start is used instead. Stored per attempt (`render_ms`). Not shown for cached, failed or cancelled attempts, or when neither source is available.
- **Failed:** the server's reason in plain words, the node and error type, and **Retry**, **Load settings**, **Copy details**.
- **Cancelled:** "Stopped at 40%. No video was saved." **Retry**, **Load settings**.
- **Cached:** "Finished instantly. The server reused an earlier result because every input, including the seed, was identical." **Render again with a new seed**.

**Retry** queues a new attempt with the next `#N` and leaves the old record as it is. It uses the attempt's stored values, the current version of its workflow and the same seed. **Render again with a new seed** does the same with a random seed. Neither re-sends the stored final JSON, because that could not pick up re-uploaded inputs.

### Compare view (wireframe 09)

Purpose: judge 2 to 4 attempts of one shot side by side and pick the keeper.

- Opened from "Compare selected" in the Shot view. Full window, no sidebar. **Close** returns to the shot.
- **Layout:** 2-up, 3-up or 4-up. Each player shows attempt id, workflow chip, a KEEPER tag if it is the keeper, a one-line summary (turbo or full, steps, duration, megapixels, seed, age), and:
  - **Swap:** replace this attempt with another from the same shot.
  - **Set as keeper** (disabled and labelled "Current keeper" on the keeper).
  - **Load settings:** copies the attempt's workflow and values into the Shot view form.
- **Shared controls:** play/pause, seek bar and time, **Speed** (1x, 0.5x, 0.25x), **Sound from** (one attempt or none; none by default, so the view opens silent), **Loop**, and a **Play together** switch in the header that keeps all players on the same time.
- **What differs:** a table with one row per input whose value differs between the attempts, one column per attempt. Cells that differ from the first column are shaded. Inputs identical in all attempts are listed on one line ("Same in all: Prompt, Duration, ..."). Reference images and frame images compare by file.

### Library (wireframes 10, 11)

Purpose: keep prompts for reuse, and define the prompters that generate new ones. Two tabs.

**Prompts tab (wireframe 10):**

- Search, tag filter pills (with counts), sort (default "Recently used"), **New prompt**.
- List of prompts: name, times used, first two lines of text, tags.
- Detail panel for the selected prompt: **Name**, **Prompt**, **Tags** (add and remove), **Note**, and **Use in shot**: a shot dropdown with **Replace its prompt** or **Add to its prompt list** (switches that shot to list mode if needed). Shows usage ("Used 9 times, last in ..."). **Save changes**, **Duplicate**, **Delete**.
- Prompts get into the Library with **New prompt**, or from a shot's prompt box with the **Save to Library** link.

**Prompters tab (wireframe 11):** a prompter turns a recipe into a list of prompts. Three types, chosen with a segmented control. All produce plain text prompts for the prompt list.

- **Template:** a template with `{slot}` placeholders (anything in braces becomes a slot). A table of slots: name, **how to pick** (Pick at random, Go in order, Always the same), values (one per line), count. Below: **Prompts to make**, a **randomness seed** with **New seed** (the same seed always gives the same list, so a batch can be rebuilt), **Avoid repeats**, and a **Preview** that generates a few samples. Generate in a shot uses the prompter's saved seed, so a list can be rebuilt; press **New seed** in the Library for a different list. The first letter of each prompt is capitalised.
- **LLM:** a **prompting skill** (optional, see below), an instruction, an input (one idea per line, pasted when it runs, or the current shot prompt), an **endpoint** (an OpenAI-compatible chat API, such as a local server), a **Model**, an optional **API key** (stored in `app.db` with the prompter), temperature, and **Test with one idea**. The app calls `POST {endpoint}/chat/completions` once per idea, with the instruction as the system message. With the current shot prompt as input it makes N variations of that prompt. If a reply contains a fenced code block, the first block is taken as the prompt. A note states that ideas are sent to this endpoint, not to the ComfyUI server. An LLM prompter is also what a shot's Prompt chat talks to.
  - **Prompting skill:** a Markdown guide written for one class of workflows (a **workflow type**, such as `minimax_h3`), holding the rules and best practices for prompting them. Skills are plain files at `prompter/skills/<workflow type>/skill.md` in the workspace, shared by all prompters and projects.
  - The dropdown lists **No skill** and every skill in the workspace (type, plus the `name` from the file's front matter). Under it: the front matter `description`, the file's size with a rough token count, **Show file**, **Replace file…** and **Delete skill** (asks first, then moves the folder to the system trash).
  - **Add skill file…** asks for the workflow type (letters, digits, `_` and `-`; anything else becomes `_`), then for a Markdown file from anywhere, and copies it into the workspace. An existing skill of that type is replaced.
  - With a skill, the system message is the whole skill file, then the instruction (which may be empty), then a line asking for the prompt only. The file is read from disk on every request, so hand edits apply at once and a folder added by hand (for example from git) is listed. Any file name's case is accepted (`SKILL.md`). If the file is missing, generating fails with a message naming the folder; nothing is sent.
  - The whole file goes out with every request, so the model's context window must fit it.
- **Script:** a script file and a runtime (Python or Node). The app starts it as a child process (`python3`, or `python` on Windows, or `node`; `COMFY_DIRECTOR_PYTHON` / `COMFY_DIRECTOR_NODE` override the command), writes a JSON object to stdin (count, seed, current prompt), and reads a JSON list of prompts from stdout, with a 60 s timeout. **Test run** shows the output. The script runs with the user's own rights and only from a path the user chose.
- Each prompter has **Save prompter**, **Duplicate**, **Delete**. The Prompt list mode picks from this list.

### Projects (wireframe 15)

- The **Project switcher** at the top of the sidebar lists the projects with their shot counts. Menu: **New project**, **Rename project** (renames the folder; refused while the project has queued or running jobs, because their downloads write into the folder), **Open project folder**, **Open existing project...**, **Remove from list**.
- **New shot** (dialog, wireframe 15): opened from the **+** next to LOOSE SHOTS, or from **Add shot** in a Sequence view (then "Where" is preset). Fields: **Shot name** (default "Untitled shot"); **Where**: *Loose shot* (belongs to no sequence) or *In a sequence* with a sequence dropdown; **Workflow** (default the last used one). **Create shot** opens the new shot in the Shot view. A shot added to a sequence goes at the end. To change it later, use **Move to sequence** in the Shot view (loose to sequence, sequence to sequence, or back to loose).
- **New sequence:** the **+** next to SEQUENCES asks for a name, then opens the empty Sequence view with its **Add shot** button.
- **New project:** a name, and a read-only preview of its folder (`<workspace>/projects/<name>`). Names must be unique and file-system safe.
- **Remove from list** only forgets the project in the app. It never deletes the folder or its files. To bring it back, use **Open existing project...** and pick the folder.
- A project is self-contained (see Local Storage), so copying its folder to another workspace and opening it there works.
- Moving a shot to another project is not supported. Duplicate shot works inside a project only.

### Settings and first launch (wireframes 08, 13)

- **Settings screen (wireframe 13)**, opened from the sidebar, has five cards:
  - **Server:** server address, access token (optional, for a reverse proxy; sent as `Authorization: Bearer`), **Test connection** ("Connected. 142 node types found", from `GET /object_info`). This is the same form as the first-launch connect step. The token is stored encrypted in the app data folder, not in the settings file (see Local Storage). A **Server files** button opens the Server files screen.
  - **Workflows:** the imported workflows, each with **Edit** and **Delete** (see Import workflow).
  - **Text size:** the size of body text in pixels: 13, 14, 15 (default), 16 or 18. Every other text size scales with it; spacing, control heights and thumbnails do not change. It applies at once and is stored in the app settings. (The wireframes are drawn at 14.)
  - **Workspace folder:** its location with **Change folder** and **Open folder**, a one-line description of what it holds, and the warning not to use a synced folder (see Local Storage). Changing it moves nothing: the user picks an existing workspace or creates a new one.
  - **Reset workspace:** a **Reset workspace…** button opens a dialog with two choices, then a native confirmation that lists what will go (Cancel is the default button). Nothing is deleted without that confirmation; it is asked by the main process, not the screen.
    - **Projects only:** moves everything in `projects/` to the system trash and clears the project list in `app.db`. Workflows are kept.
    - **Projects and workflows:** also moves everything in `workflows/` to the system trash and clears the workflow index, the version history (numbering starts again at 1) and the last used workflow.
    - Kept in both cases: the prompt library, prompters, and everything in the app data folder (server, token, theme, text size). Projects stored outside the workspace (added with **Open existing project...**) are removed from the list but their folders are not touched.
    - Refused while any project has queued or running jobs, because their downloads write into the project folder. Afterwards no project is open and the Queue's finished list is empty.
- **First launch:** three steps shown as a bar: Connect, Import a workflow (the Import screen, with "Skip for now"), First project (name it; the folder preview shows where it will live). The workspace folder is created silently at the default location and can be changed in Settings. The import step is also what the app shows any time it has no workflows.

### Server files

Opened from the Server card in Settings. Lists the files on the ComfyUI server and deletes the ones selected, to free disk space there. It never touches files in the projects.

- **Needs the companion node.** ComfyUI has no route for listing a folder or deleting a file, so the server must have the `comfy_director_files` node installed (see Companion node). Without it the screen explains this, with **Open the node folder** (the folder to copy to the server) and **Check again**. While the server is not connected the screen says so.
- **Three folders**, one at a time: **Uploaded refs** (`input/`), **Rendered files** (`output/`) and **Temp** (`temp/`), each listed with its subfolders. A line under the switch says what the folder holds.
- **List:** one row per file with a thumbnail, name, subfolder, size and when it was last modified. **Filter by name** narrows it. The rows are grouped by the day the file was last modified, latest first: one group for each day of the current week (weeks start on Monday) headed **Today**, **Yesterday** or the weekday with its date, then **Before this week** for everything older. Each heading shows the group's file count and size, and its checkbox selects the whole group. Inside a group the order is **Newest** (default), **Largest** or **Name**. 300 rows are drawn at a time, with **Show more**. The header shows the file count and total size, or the count and size of the selection. **Refresh** reads the folder again.
- **Thumbnails** are made by the server: the image itself, or the first frame of a video, at most 256 pixels on its long side, shown cropped to a square. They load as their rows scroll into view. Audio and other files show their file extension instead, as does a picture the server could not make (an unreadable file, or a companion node from before thumbnails). Clicking a thumbnail opens the preview.
- **Preview** opens an image, video or audio file in a dialog. The file is streamed from the server through the main process (`ctmedia://server/`), so the token never reaches the screen.
- **Delete from server**, or the Delete key, removes the selected files after a native confirmation that names the count, the size and the server. Clicking a row selects or deselects it; Shift+click does the same to every row from the last clicked one to this one. The header checkbox selects every file that matches the filter. Deletion is permanent: the server has no trash. Files the server could not delete are named in an error message.
- **Deleted refs are uploaded again.** The app forgets the upload of every deleted input file, in every project, so the next Run that uses the ref uploads it from the project's `inputs/` folder.
- **Deleting rendered or temp files clears the server's cache of node results** (loaded models stay loaded). Otherwise a job identical to an earlier one would be answered from the cache with the name of a deleted file, and its download would fail. The next job on the server therefore runs every node again.
- While a folder is loading its list is empty and Delete is off, so a selection can only ever hold files of the folder on screen.
- Nothing checks whether a file is still needed by a job in the queue. A waiting job whose ref is deleted fails when it starts.

### Theme and colours (wireframe 14)

- **Modes:** Auto (default), Light, Dark. Auto follows the operating system and changes live when it changes. The choice is stored in the app settings and is set from the Theme switch at the bottom of the sidebar.
- **Palette:** warm neutrals (paper-like light, warm charcoal dark) with one blue accent. All colours come from named tokens, never hard-coded in components, so the palette can be adjusted in one place.

  | Token | Light | Dark | Use |
  |---|---|---|---|
  | `bg` | `#F5F2EC` | `#1C1A17` | Window background |
  | `panel` | `#FFFDF9` | `#26231F` | Cards, inputs, sidebar |
  | `fill` | `#E8E2D6` | `#36322B` | Grey fills, disabled buttons |
  | `stripe` | `#EFEAE0` | `#2F2B25` | Placeholder stripes, hover |
  | `border` | `#DDD6CA` | `#3A3630` | Dividers, card borders |
  | `control` | `#8A8273` | `#8F8779` | Input and button borders |
  | `text` | `#26231F` | `#EDE8DF` | Main text |
  | `text2` | `#433E36` | `#D3CCC0` | Secondary text |
  | `muted` | `#675F54` | `#A39C8F` | Hints and labels, on `bg` and `panel` only |
  | `accent` | `#2447C9` | `#4A63DC` | Primary button fill, progress bar (white text on it, both modes) |
  | `accentText` | `#2447C9` | `#AEBBFF` | Links, selected text |
  | `tint` | `#E7E9F7` | `#2A2E4F` | Selected row, info strips |
  | `danger` | `#B4400F` | `#E8845A` | Errors, delete |
  | `dtint` | `#FBEDE6` | `#3B2418` | Error background |
  | `disabled` | `#5A5448` | `#B8B1A4` | Disabled text, on `fill` |

- **Contrast:** text against `bg` and `panel` is at least 12.8 : 1; `muted` is at least 5.6 : 1 on `bg` and `panel` (4.9 : 1 on `fill`); input and button borders (`control`) are at least 3.7 : 1; white on `accent` is 7.4 : 1 (light) and 5.1 : 1 (dark). Use `text2`, not `muted`, on `fill`.
- The wireframes are drawn in the light tokens. Dark uses the same layout with the dark tokens (wireframe 14 shows both on one sample card).
- Video previews and thumbnails are never tinted by the theme.

### States (wireframes 07, 08)

Error and connection states (wireframe 07):

1. **Server offline or token refused:** a banner on every screen ("Can't reach server-01. Retrying in 8 s. Your inputs and history are kept.") with **Retry now** and **Server settings**. Inputs, history and finished renders stay usable. Only Run is off. The sidebar shows "offline". A refused token says to check it in Server settings.
2. **Back online, jobs updated:** on launch and on reconnect the app compares its running attempts with the server's queue and history (see Job tracking). A banner summarises ("While the app was closed, 1 attempt finished and 1 failed. 4 jobs are still waiting.") with the affected attempts and **Open shot** or **Details**. **Dismiss** closes it.
3. **Upload failed:** input files upload when Run is pressed. One failing file stops the whole run, so nothing half-queued is left behind. The failing slot is marked, with **Retry upload** and **Remove image** (or video, or audio file).
4. **Rejected when pressing Run:** the app validates first (minimum and maximum values, option still offered by the server, slot count within the workflow's maximum). If the server still rejects a job, its message appears on the field it came from (matched through the node id and input name in the server's error); anything that cannot be matched is listed in the message line. A line states how many problems remain.
   - Run validates, uploads, then posts the jobs. If any `POST /prompt` fails, the jobs of that Run already queued are removed by id (or interrupted, if one already started) and their attempt records are deleted.
   - The app then reads the queue again. Jobs the server did not give back keep their attempts, and the message says how many will still run instead of "Nothing was queued". If the queue cannot be read, the jobs are kept and the queue poll settles them.
5. **Failed, cancelled and cached attempts:** see Attempt states.

Empty states (wireframe 08), each pointing to the next step:

- No projects: the first-launch "First project" step, or in the switcher a **New project** item.
- No sequences or shots in the project: "Start your first shot" with **New shot** and **New sequence**.
- A new shot: default values, and "No attempts yet. Fill in the inputs and press Run."
- Empty sequence: "Add the first shot". Play is off until a shot has a keeper.
- Empty Gallery: "Nothing rendered yet". A search with no results says "No renders match ..." with **Clear filters**. Filters stay visible so the cause is clear.
- Queue idle: "Nothing running, nothing waiting."

### Out of scope

- Stitching or exporting a final edited video. The Sequence view only previews the keepers in order.
- Multiple users or cloud sync.

## Implementation Notes

### Job tracking

- **Progress percent** is an estimate, because ComfyUI has no overall progress: 0 to 5 % while nodes before sampling run, 5 to 95 % from `progress` events (sampler steps), 96 % after sampling, 100 % when the file is downloaded.
- **Cached:** an attempt is CACHED when every output node of the job appears in `execution_cached`. The (identical) output file is still downloaded, so the attempt has its own file.
- **Reconcile:** on launch and on reconnect the app compares its active attempts with `GET /queue` and `GET /history`. The summary is held in the main process until the window collects it.
- **Jobs that leave the queue without an event** (removed by another client) are checked against history after 10 s and marked cancelled ("Removed from the queue before it started") if there is no record.
- **A failed history request is not "no record".** A request error leaves the attempt as it is and the app asks again (reconcile after 5 s, otherwise on the next queue poll). Only an answered, empty history marks the job failed or cancelled.
- **Downloads are tried three times.** When fetching the result fails on a request error, the attempt stays active and reconcile runs again after 5 s (or on reconnect); the third failure marks it failed. All output files of a job are fetched before any is written.
- **Attempts sent to another server address** stay untouched while that address is not the one in Settings, and are picked up again if it comes back. Cancel on such an attempt marks it cancelled locally and says the job was not cancelled on that server.

### Interrupt rule

`POST /interrupt` stops whatever the server is running, including a job started by another client. So **Interrupt** in the Queue drawer, and **Cancel** on a running attempt card, must first check that the running job's `prompt_id` belongs to an attempt of this app (from `GET /queue`). If it is not ours, the button is not offered. The interrupt is sent for that specific `prompt_id`. Cancelling a waiting job removes only that job's id, and never uses a clear-all call; the app reports when a waiting job was not removed.

### Output rules

- **Where:** inside the project folder, `<workspace>/projects/<Project>/outputs/`. Files are downloaded automatically when a job finishes (`GET /view`), never on demand later. Nothing is deleted from the server unless the user does it on the Server files screen.
- **Which files:** every `{filename, subfolder, type: output}` entry of the job in `GET /history`, under any key.
- **Layout:** `outputs/<Sequence name>/<NN Shot name>/attempt-<id>-<workflow>.<ext>`. Loose shots go under `outputs/_loose/<Shot name>/`. Names are made safe for the file system (illegal characters replaced, length limited).
- **File names** use the project-wide attempt id, not the per-shot `#N` shown in the UI, because shot names are not unique and two shots can share a folder. If the name is still taken, ` (2)`, ` (3)`... is added: a rendered file is never overwritten.
- **Renaming:** each attempt's file path is stored in `project.db`, relative to the project folder. Renaming or moving a shot does not move existing files. New attempts use the current names.
- **Export keepers:** an action on the Sequence view that copies each shot's keeper to `outputs/_keepers/<Sequence name>/<NN Shot name>.<ext>`, numbered in sequence order, replacing earlier exports. It never moves or deletes the originals.
- **Thumbnails:** one still frame per attempt, made in the renderer when the file is downloaded (`<video>` to canvas to JPEG, 480 px at most, no ffmpeg) and stored at `thumbs/attempt-<id>.jpg` in the project. The video duration is recorded at the same time for the keeper timeline. Gallery sort order is newest first by default.
- **Local media** is shown through `ctmedia://` URLs, which serve only the workspace and known project folders, with HTTP Range support for seeking. `ctmedia://server/` URLs are the exception: they pass a file from the server's input, output or temp folder through (`GET /view`, with the Range header), or its thumbnail when the URL has `thumb=<pixels>`, for the Server files screen.

## ComfyUI API Endpoints Used

| Endpoint | Purpose |
|---|---|
| `POST /prompt` | Queue a job, returns `prompt_id` |
| `WS /ws?clientId=...` | Progress and completion events |
| `GET /history/{prompt_id}` | Output file info after completion |
| `GET /view` | Download an output file |
| `POST /upload/image` | Upload input files |
| `GET /object_info` | Available nodes and model names |
| `GET /queue` | Queue inspection, including jobs from other clients |
| `POST /queue` (`delete` list of prompt ids) | Cancel waiting jobs |
| `POST /interrupt` (`prompt_id`) | Stop the running job, if it is ours |
| `GET /comfy_director/files?type=` | List the input, output or temp folder (companion node) |
| `GET /comfy_director/thumb` | Thumbnail of an image or video in those folders (companion node) |
| `POST /comfy_director/files/delete` | Delete files from those folders (companion node) |

When a token is set, every request and the WebSocket carry it as `Authorization: Bearer`.

Checked on the real server (2026-10-08): cancelling a waiting job, interrupting a running job, finding and downloading `SaveVideo` outputs, and the WebSocket on a direct connection. The WebSocket through a reverse proxy with a token has not been confirmed separately.

For development, `npm run fake-server` runs a fake ComfyUI that answers these routes with scripted scenarios (`#fail`, `#oom`, `#reject`, `#slow` in a prompt). `NO_FILES_NODE=1` makes it answer like a server without the companion node.

### Companion node

`comfyui-node/comfy_director_files/` is a ComfyUI custom node kept in this repository and shipped with the installer (in the app's resources folder). It is installed by copying the folder into `ComfyUI/custom_nodes/` on the server and restarting ComfyUI. It adds no graph nodes, only the three routes above.

- `GET /comfy_director/files?type=input|output|temp` answers `{version, files: [{filename, subfolder, size, modified}]}`, walking subfolders. `modified` is in seconds.
- `GET /comfy_director/thumb?type=&subfolder=&filename=&size=` answers a JPEG at most `size` pixels (32 to 512, 160 if not given) on its long side: the image, or the first frame of a video, read with Pillow and PyAV, which ComfyUI already needs. Anything else, or a file that cannot be read, answers 404. The last 2000 thumbnails are kept in memory, keyed by the file's path, size and modified time.
- `POST /comfy_director/files/delete` takes `{files: [{filename, subfolder, type}]}` and answers `{deleted, errors}`. A file that is already gone counts as deleted. Folders are never removed. When a file was deleted from `output/` or `temp/`, it sets the queue flags `free_memory` (with `unload_models` off), which makes ComfyUI's worker reset its node cache after the running job.
- A path is resolved inside the folder named by `type` and refused if it would land outside it, so nothing else on the server (models, custom nodes, the ComfyUI install) can be listed or deleted.
- The routes have no protection of their own. They are covered by whatever protects the server, such as the reverse proxy token.
- The app treats a 404 or 405 answer from the list route as "node not installed".

Not yet run on a real ComfyUI server: the node's logic is tested on its own and the app against the fake server.
