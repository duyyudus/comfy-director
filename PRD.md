# Comfy Toolkit: Foundations

## Goal

The app is called **Comfy Toolkit**. Use that name for the window title, the installer, the app data folder (`Comfy Toolkit`), the package name (`comfy-toolkit`) and the default output folder.

A desktop app that acts as a custom client for a ComfyUI instance running on a remote server. The ComfyUI node graph is used to design workflows; this app is used to run them (batch rendering, input swapping, custom prompts, output management) without repeating manual work in the graph UI.

This document covers the stack, the architecture, how workflows are handled, local storage, and the features and screens (see "Features and UI"). Wireframes for the screens are in `docs/wireframes/`: use the PNGs for layout and this document for behavior.

## Tech Stack

| Layer | Choice |
|---|---|
| Desktop shell | Electron |
| Build/scaffold | electron-vite (React + TypeScript template) |
| UI | React + Tailwind + shadcn/ui |
| Language | TypeScript everywhere |
| State (UI) | Zustand |
| Local database | SQLite via better-sqlite3 (main process) |
| ComfyUI client | `fetch` + `ws` in the main process |
| Theming | CSS variables (the tokens in Theme and colours), Tailwind `dark:` variant; Electron `nativeTheme.themeSource` set to `system`, `light` or `dark` |
| Packaging | electron-builder (only when an installer is wanted) |

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

Written as plain TypeScript with no Electron or React imports, so they can be reused from a CLI or another shell later:

1. **Workflow adapter:** loads an API-format JSON plus a mapping file (logical name to node ID and input, e.g. `positive_prompt` to node 6, `text`) and applies values to a copy of the template.
2. **Run planner:** expands the prompt list and the runs count into a list of jobs (one attempt each).
3. **Prompter:** produces prompt text, designed as a swappable interface so custom prompters can be plugged in.
4. **Output manager:** handles completed jobs, downloads files, applies the user's naming/sorting rules, records them in SQLite.

## Key Facts About ComfyUI to Design Around

- **Two workflow formats.** The graph UI saves *UI format* on the server (`user/default/workflows/`), which cannot be sent to `/prompt`. Execution requires *API format* (flat `node_id` to `{class_type, inputs}`), exported via **Save (API Format)** (needs Dev mode options on).
- **The app stores its own API-format workflows** (imported by the user, kept locally). After changing a workflow in the graph, the user re-exports and re-imports it. An API-format prompt can also be recovered from `GET /history/{prompt_id}` or from PNG output metadata.
- **File inputs are filenames, not data.** Images/videos must be uploaded to the server first; the JSON then references the returned filename.
- **Models are resolved on the server.** Checkpoint/LoRA/etc. names must match files on the server. `GET /object_info` lists valid options.
- **Node IDs change when a workflow is re-exported.** Keep the mapping file separate (or look nodes up by `_meta.title`) instead of hardcoding IDs.
- **Caching.** Identical workflow plus identical inputs (including the seed) may be served from ComfyUI's cache without re-rendering.
- **No built-in auth.** If the server is reachable beyond a trusted network, put it behind a reverse proxy with a token or a VPN.
- **Custom nodes** used by a workflow must be installed on the server, not on the desktop.

## Workflow Handling

Workflows will change over time (inputs added, removed, renamed), and different workflows expose different inputs (e.g. fl2vid vs ref2vid). The app therefore treats the exported workflow as the source of truth and **generates the input UI from it**, rather than hardcoding a screen per workflow.

Reference workflows used for design (all MiniMax H3):

| File | What it is | Notes |
|---|---|---|
| `video_minimax_h3_r2v.json` | Reference-to-video (ref2vid), 6 ref images | Flat node ids. Prompt comes from an `Input Text (Prompt)` node. |
| `video_minimax_h3_i2v_continuation.json` | First and last frame to video (fl2vid) | Node ids carry a subgraph prefix (`105:...`). Prompt is typed directly on the `MiniMaxH3ImageToVideo` node. Two `LoadImage` nodes, both titled "Load Image". |
| `video_minimax_h3_t2v.json` | Text to video (t2v) | Identical to fl2vid except: no `LoadImage` nodes, no `first_frame` / `last_frame` links, different default values, and subgraph prefix `140:`. |

What these three files teach (each rule is written into the sections below):

- Node ids are not stable: the same workflow exports with no prefix, `105:` or `140:`. Ids must be treated as opaque strings and never parsed or sorted as numbers.
- Titles are not consistent across workflows either (`Float (Duration)` vs `Float (duration)`, `If/Else Switch (Model)` vs `(model)`). Input keys therefore need a derivation rule (see Input keys).
- The prompt is not always an input node. In fl2vid and t2v it is a field on a regular node and must be exposed through the overrides layer.
- t2v is fl2vid with both images left out, so optional file inputs (below) cover t2v, i2v (first frame only) and fl2v in one workflow.

### Schema vs values

- **Schema:** derived from a workflow. A list of inputs, each with `{key, type, label, constraints, default, where it writes in the JSON}`.
- **Values:** a flat `{key: value}` map per job or preset.
- The UI renders the schema using one small component per input type (text, number, toggle, select, file, file-group). A new input kind means adding one component, not a new screen.
- The batch planner, presets, and history only handle `{workflow, values}`, so a workflow changing shape does not ripple through the app.

### Three layers

1. **Auto-discovery on import.** Scan the API JSON for obvious input nodes:
   - `PrimitiveStringMultiline`, `PrimitiveInt`, `PrimitiveFloat`, `PrimitiveBoolean` become text, number and toggle controls. Label from `_meta.title`, default from the current value.
   - `LoadImage` becomes a file input.
   - Several `LoadImage` nodes feeding one dotted input group on a single node (e.g. `ref_images.ref_image_0..N`) become one **file-group** control with add/remove.
   - Dropdown options and ranges come from `GET /object_info`.
   - Note: the old frontend-only "Primitive" node disappears at export (its value is baked into the target node), so workflows using it need the override layer. The newer `Primitive*` nodes remain real nodes and are discoverable.
2. **Overrides (optional sidecar).** Holds exceptions only: exposing a field on a regular node (e.g. `ResolutionSelector.megapixels`), hiding a discovered input, renaming, ordering, min/max. Most workflows need little or nothing here.
3. **Reconcile on re-import.** Diff the new schema against the old one using a stable key (node title, not node ID):
   - New input: appears in the UI with its default.
   - Removed input: disappears; saved values referencing it produce a warning, not a crash.
   - Matching input: keeps saved values and presets.

### Convention in the node graph

Give every control node a clear, unique `_meta.title` (e.g. `Input Text (Prompt)`, `Float (Duration)`, `Boolean (Enable Lightning LoRA)`). Node IDs change on re-export; titles are the stable key. Repeated titles (such as several `Load Image` nodes) are resolved by following links from the consuming node instead (see Input keys). Titles are matched after the normalisation in Input keys, so a difference in capitals is harmless, but a different word is a different input.

### Input keys

Values are matched across workflows and across re-imports by key, so keys must come out the same for the same thing:

- **Primitive input nodes:** the text inside the parentheses of the title if there is one, otherwise the whole title, lowercased and trimmed. `Float (Duration)` and `Float (duration)` both give `duration`. `Input Text (Prompt)` gives `prompt`. `Boolean (Enable Lightning LoRA)` gives `enable lightning lora`.
- **Exposed fields on regular nodes (overrides):** the field name, for example `prompt`, `aspect_ratio`, `megapixels`, `noise_seed`. The same field on the same node class in two workflows gives the same key, so a typed-in prompt on `MiniMaxH3ImageToVideo` shares its value with the `Input Text (Prompt)` node in ref2vid.
- **File inputs:** the name of the consumer input they feed (`first_frame`, `last_frame`, `ref_images.ref_image_N`), because `LoadImage` nodes are normally left as "Load Image".
- An override can always set an explicit key. If two inputs in one workflow derive the same key, the Import screen flags it and asks for a rename.

### Optional file inputs (first and last frame, text-to-video)

- On import, `GET /object_info` tells which inputs of the consumer node are optional. A `LoadImage` feeding an **optional** input is an optional file input. One feeding a required input is required.
- **Empty optional input:** before sending, the app deletes that `LoadImage` node and the link on the consumer node. The result is a valid workflow that simply has no image there. This is the same mechanism as unused ref image slots.
- **Required input empty:** Run is blocked with a message on that field.
- In `MiniMaxH3ImageToVideo`, `first_frame` and `last_frame` are optional. With both empty the result matches `video_minimax_h3_t2v.json` (checked by comparing the two files). With only a first frame it is image-to-video. Whether the node runs correctly with only a first frame has not been tested and must be tried once on the server.
- Because of this, importing only the fl2vid file covers t2v, i2v and fl2v. Importing the t2v file as well is optional: it is the same graph with different defaults (16:9, 1 megapixel, 5 s, turbo off), so it would only add a tab.

### Variable-count inputs (ref images)

- Ref slots are not a list. Each is a separate key on the consumer node (`ref_images.ref_image_N`) linking to its own `LoadImage` node.
- To use fewer images: keep only the first N slots, delete the other keys and their unused `LoadImage` nodes, and set each remaining loader's filename to the uploaded file.
- To use more: clone a `LoadImage` node with a new ID and add the next slot key.
- Keep slot indices contiguous (0, 1, 2, ...).
- Slot order is defined by the links on the consumer node, not by node ID order.
- Min and max counts should be checked via `GET /object_info` and tested (e.g. 1, 3, max).

### Toggles that change several things (turbo / Lightning LoRA)

In the reference workflow, a single boolean node drives two switch nodes: one selects the LoRA'd vs base model, the other selects 4 vs 20 steps. So the toggle is one value (`PrimitiveBoolean.value`) and the graph handles the rest. Prefer this pattern over editing or removing nodes from the app. If a workflow lacks such a switch, the fallbacks are setting LoRA strength to 0 or keeping two exported templates.

### Seed

API format has no "randomize after run". The app generates a new seed per job when wanted. Identical workflow, inputs and seed may be served from ComfyUI's cache instead of re-rendering.

### Inputs left baked in

Model, VAE and CLIP names, sampler, scheduler, and LoRA strength stay as set in the graph. In the reference workflow, fps appears in both the video node and the frame-count math, so it is not exposed.

## Local Storage

The ComfyUI API-format JSON is used as the workflow file itself. No custom workflow format.

### Principles

- **Keep `workflow.json` untouched.** It is the exported file as-is. Re-exporting after a graph change simply overwrites it, with nothing to merge.
- **Stay portable.** The file can be loaded back into ComfyUI, shared, or run by other tools.
- **Never add custom keys to the workflow JSON.** ComfyUI treats every top-level key in the prompt as a node, so extra metadata would fail validation.
- **App-specific data lives beside it,** not inside it.
- **The schema is not stored.** It is derived from `workflow.json` on import and can be regenerated at any time.

### Layout

One **workspace folder** (default `~/Comfy Toolkit/`, set in Settings) holds app-wide data and a folder per project:

```
Comfy Toolkit/                     workspace
  workflows/                       app-wide
    minimax_h3_r2v/
      workflow.json                exported API-format file, untouched
      overrides.json               optional, exceptions only
    minimax_h3_fl2v/
      workflow.json
  app.db                           app-wide SQLite: prompt library, prompters, workflow index
  projects/
    Rooftop short/                 one folder per project (folder name = project name)
      project.db                   project SQLite: sequences, shots, attempts, keepers
      inputs/                      copies of images chosen in this project
      outputs/
        Rooftop chase/
          03 Roof edge/
            attempt-6-ref2vid.mp4
        _loose/
        _keepers/
    Client teaser/
```

- **App-wide** (`workflows/`, `app.db`): things shared by every project. Workflows are plain files so they can be hand-edited and versioned with git. The prompt library and prompters are shared so they can be reused across projects.
- **Project-wide** (`projects/<name>/`): everything that belongs to one body of work. A project can be renamed, moved, archived or backed up as one folder. Each attempt keeps the exact final JSON that was sent (see Reproducibility), so a project still makes sense on a machine that lacks the original workflow files.
- **Paths inside `project.db` are relative to the project folder.** Renaming the project renames the folder and nothing else changes.
- **Plain files** for things worth hand-editing (workflows, overrides). **SQLite** for things that grow and need querying (history, keepers, prompt library).
- **Not in the workspace:** the server address and workspace path (app settings, in the app's data folder) and the access token (operating system keychain). Sharing a workspace never shares the token.
- Add a `.gitignore` to the workspace that excludes `app.db`, `projects/` and anything else not meant for git, so `workflows/` can be versioned on its own.
- **Do not place the workspace in a synced folder** (Dropbox, iCloud, OneDrive): SQLite files can be corrupted. Settings shows a warning.
- Presets (named value sets) are not designed yet (see Not designed yet).

### Input files

- When the user picks an image for a file input, the app **copies it into the project's `inputs/`**, named by a hash of its content (original name kept in the database for display). The project therefore does not depend on the original file staying where it was.
- On Run, the file is uploaded to the server under its hash name, so two different pictures never collide and the same picture is uploaded only once.

### Reproducibility

- Store an import timestamp or hash of `workflow.json`, so a job record states which version of the workflow it ran.
- Each finished job keeps the exact final JSON that was sent (or at minimum the values map plus the workflow hash), so an old render can be re-run or tweaked later.

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
| **Attempt** | One render. Stores the shot, the workflow and its version hash, the full values map, the seed, status, `prompt_id`, output files, and timestamps. Also keeps the exact final JSON that was sent (see Local Storage > Reproducibility). |
| **Keeper** | The attempt the user chose as the result for a shot. At most one per shot. |
| **Run** | One click of the Run button. It creates one attempt per prompt per run (prompts x runs) and queues them all at once. |

Rules:

- **Values belong to the shot, not the workflow.** Values are keyed by input key. Switching the active workflow keeps every value whose key exists in the new workflow's schema. Values for keys the new workflow does not have are kept but hidden, and come back if the user switches back.
- **A shot's workflow is a per-attempt choice.** Attempts in one shot can use different workflows (e.g. to compare ref2vid and fl2vid on the same content).
- **Setting a keeper** replaces the previous keeper. Deleting the keeper attempt clears the keeper (with a confirmation).
- **Shared vs workflow-only inputs:** inputs whose key exists in every imported workflow are shown first; inputs that exist only in the active workflow are shown below a "WORKFLOW ONLY" divider.

### App shell (on every screen)

- **Sidebar:**
  - App name (Comfy Toolkit) and server status (dot plus server name; "connected" or offline).
  - **Project switcher** under the app name: the current project with a menu (see Projects). Everything below it belongs to that project.
  - **Sequences:** a **+** button in the header row creates a new sequence (see Projects). Each sequence expands to its shots, one row per shot (`NN Name`). A filled dot means the shot has a keeper, a ring means none yet. The current shot is highlighted.
  - **Loose shots:** same rows, no numbering. A **+** button in the header row creates a new loose shot (New shot dialog, preset to Loose shot).
  - Links to **Gallery**, **Library** and **Settings**.
  - **Theme switch** at the bottom: Auto / Light / Dark (see Theme and colours).
- **Queue strip** (bottom of every screen): currently running job (shot name, percent), a progress bar, count of waiting jobs, and an "Open queue" button, which opens the Queue drawer (wireframe 06). When nothing is queued it reads "Idle".
- **Connection banner** at the top of every screen when the server cannot be reached (see States).
- The sidebar's Sequences, Loose shots, the Gallery and Compare show the current project. The queue strip and Queue drawer show jobs from every project, each labelled with its project when it is not the current one (not drawn).
- Clicking a sequence name opens the Sequence view. Clicking a shot opens the Shot view.

### Shot view (wireframes 01, 02)

Purpose: set up inputs for one shot, run attempts, and review them. This is the main screen.

- **Header:** breadcrumb (sequence, shot number, keeper id, attempt count), editable shot name, and two actions:
  - **Duplicate shot:** new shot with the same workflow and values, no attempts, placed after the original (or loose, if the original is loose).
  - **Move to sequence:** moves the shot to a sequence at a chosen position, or to Loose shots.
- **Workflow tabs:** one tab per imported workflow plus "+ Import workflow" (opens the Import view). Switching tabs follows the values rules above.
- **Input form:** generated from the active workflow's schema (see Workflow Handling), one component per input type:

  | Input type | Control |
  |---|---|
  | text | Multi-line text box |
  | number | Number field (with min/max/step from the schema or overrides) |
  | toggle | Checkbox with label and short help text |
  | select | Dropdown; options from `GET /object_info` |
  | file | One image slot with Replace. An optional file input can be empty and shows "Add" and, when filled, "Remove"; a hint says what an empty slot means (for example "Leave both frames empty for text-to-video") |
  | file group | Slots as thumbnails with remove (x), add (+), drag to reorder, and a "n of max slots" count |

  The reference images control enforces the minimum and maximum slot counts from the schema. Unused slots are removed from the workflow before sending (see Variable-count inputs).
- **Prompt: "single" / "list" toggle.** Only the prompt can be switched to list mode (see Prompt list mode below). Every other input stays a single value. To try another duration, aspect ratio, turbo setting, workflow or set of reference images, change it and press Run again: the queue holds the jobs, and Compare shows what differs. There is no separate batch screen and no lists for numbers or choices. This can be revisited later by adding a "Vary" toggle to one input (see Open Decisions).
- **Seed:** a segmented control **Random / Fixed**.
  - Random: a new seed per job, generated by the app.
  - Fixed: the entered value is used for every job. Repeating a run with identical inputs and a fixed seed is answered from the server's cache (see Attempt states).
  - The field shows the last seed used (read-only while Random).
- **Runs box** (next to Run): how many attempts to make from the current inputs, default 1. With Random seed each run gets a new seed. In prompt list mode it is "Runs per prompt".
- **Run button:** reads "Run N jobs", where N = prompts x runs. It validates inputs (required files present, counts within bounds), uploads any input files not yet on the server, creates the attempts, and queues them all at once. If anything fails before queueing, nothing is queued (see States). Disabled while the server is offline.
- **Attempts panel** (right side), newest first. Each card shows:
  - Preview thumbnail with play (while running: percent instead).
  - Attempt id, workflow chip, and a KEEPER tag on the keeper.
  - A one-line summary (turbo or full, duration, seed, age) and a compare checkbox.
  - Actions: **Load settings** (copies this attempt's workflow and values into the form), **Set keeper**, and while running a progress bar with **Cancel**.
  - "Compare selected" opens the Compare view (wireframe 09) for the 2 to 4 ticked attempts. "Show older attempts" loads the rest of the list.
  - Failed, cancelled and cached attempts have their own card states (see Attempt states).

### Sequence view (wireframe 03)

Purpose: see the shots of a sequence in order, each represented by its keeper, and jump into any shot to revise it.

- **Header:** sequence name, counts ("4 shots, 3 keepers"), **Add shot** (opens the New shot dialog preset to this sequence), and **Play keepers in order**. Also **Export keepers** (see Output rules; not drawn in the wireframe, place it next to Play keepers in order).
- **Shot cards**, in sequence order, drag to reorder (grip handle). Each card shows:
  - Number and name.
  - The keeper preview with play, or an empty state ("No keeper yet, 0 attempts") with a "Start shot" button.
  - Workflow chip, duration, and attempt count.
  - **Open shot**, which goes to the Shot view.
- **Add shot tile** at the end of the row (same as the header button).
- **Keeper timeline:** one segment per shot, width proportional to the keeper's duration, with a dashed segment for shots without a keeper, and the total length of the keepers so far.
- **Play keepers in order:** plays the keepers one after another as a preview, skipping shots without a keeper. It does not stitch or export a video.

### Gallery (wireframe 04)

Purpose: find any render across all sequences and loose shots.

- **Filters:** project (default the current project, or All projects), search in prompt text, workflow, sequence (including "Loose shots"), and "Keepers only". **Group by:** Shot (default) or Time.
- **Groups:** a header per shot ("Sequence / NN Name, n attempts") followed by a grid of thumbnails, each with id, workflow, and KEEPER tag where it applies. The grid is virtualized and loads as the user scrolls.
- **Detail panel** for the selected render: large preview, summary of its values (workflow, duration, turbo, aspect, seed, number of refs, prompt start), and actions:
  - **Load into shot:** opens the Shot view for that attempt's shot with the attempt's workflow and values loaded.
  - **Reveal file:** shows the output file in the operating system's file manager.

### Import workflow (wireframe 05)

Purpose: add a workflow, or replace an existing one with a new version, and decide which inputs to expose. Four steps on one screen:

1. **Choose the file.** Drop or browse for an API-format `.json`. The file is validated: a file in UI format is rejected with a message that explains Save (API Format). Shows file name, "API format" badge, node count, and node-type count. Then:
   - **Workflow name** (default from the file name).
   - Either **replace the existing workflow with a new version**, or **save as a separate workflow**.
2. **Choose which inputs to expose.** A table of auto-discovered inputs (see Workflow Handling > Three layers): a checkbox to expose, an editable label, the input type, the node it comes from, and its default. Primitives start checked, except ones that only feed internal switches (the two "Steps" values), which start unchecked. Below it, **Not found automatically**: fields on regular nodes (seed, aspect ratio, megapixels in the reference workflow) with an **Expose** button, which adds an entry to the overrides file.
3. **Checked against the server.** Using `GET /object_info`: every node type is installed, every model file referenced exists, every link points to an existing node. Missing node types or models are shown as warnings and do not block the import. Invalid files (step 1) and broken links block it.
4. **What changes.** A diff against the current version, grouped as NEW, CHANGED, REMOVED, and SAME inputs, matched by node title. For removed inputs, shows how many saved presets use them: they keep the stored value, but the field is no longer shown or sent. A note states that past attempts keep the exact version they ran with.

**Import as version N** stores the new `workflow.json`, the hash and timestamp, and the updated overrides. The previous version is kept so attempts can still reference it. Cancel returns to the previous screen.

### Prompt list mode (wireframe 12)

Purpose: render many prompts for one shot in a single Run. This is the only batch feature besides the Runs box.

- Switching the Prompt row to **list** replaces the prompt box with a list of editable prompts. The rest of the form stays where it is, and every prompt uses its current values. **single** switches back (the list is kept).
- **Prompter row:** Prompter (dropdown of Library prompters), **How many**, **Generate**, a choice of **Replace list / Add to list**, and an **Edit prompter** link to the Library. Generated prompts are plain text. Nothing is re-rolled unless Generate is pressed again.
- **List:** one text box per prompt with Remove. Below: **Add prompt**, **Paste lines** (one prompt per line), **Pick from Library**.
- **Run bar:** "Runs per prompt" box and "Run N jobs", with the line "6 prompts x 2 runs = 12 jobs". Each job becomes an attempt in the shot. All are sent to the server at once and run in the server's own order. In the Queue drawer they appear as one group.

### Queue drawer (wireframe 06)

Purpose: see and cancel what the server is running. The app does not reorder jobs: **the queue order is ComfyUI's own (first in, first out).**

- Opened from "Open queue" in the queue strip. **Collapse** closes it.
- **Header:** "1 running, 10 waiting", the note that the server runs jobs in the order it received them, and **Cancel all waiting (n)**. n counts only jobs started from this app. Jobs started from other clients are never cancelled in bulk.
- **Running:** shot name, attempt id, workflow chip, a progress bar with percent, the current stage ("Sampling, step 3 of 4"), elapsed time, and **Interrupt**. Interrupt follows the Interrupt rule below.
- **Waiting:** in server order, with a position number (Next, 2, 3, ...).
  - Jobs from one Run are grouped under a header (shot, workflow, "5 prompts x 1 seed", range of positions) with **Cancel remaining (n)**. Groups collapse and expand.
  - Each job shows shot, attempt id, workflow chip, and a note (for example "prompt 2 of 5, seed random"), with **Cancel**.
  - Jobs from other clients show "Started from another client" and a prompt id. Cancelling one asks first.
- **Finished recently:** this session only. Each row shows a tag (DONE, CACHED, FAILED, CANCELLED), shot, id, workflow, a note (age, render time or reason), and **Open shot** or **Details** (for failures). Older attempts live in the shot and in the Gallery.
- **Not included:** reordering, pausing, and priorities. ComfyUI has none of these, and the app does not simulate them.
- **Launch and reconnect:** the app compares its running attempts with `GET /queue` and `GET /history` and updates their states (see States).

### Attempt states (wireframe 07, section 5)

Attempt cards in the Shot view say what happened and offer the next step:

- **Failed:** the server's reason in plain words, the node and error type, and **Retry**, **Load settings**, **Copy details**.
- **Cancelled:** "Stopped at 40%. No video was saved." **Retry**, **Load settings**.
- **Cached:** "Finished instantly. The server reused an earlier result because every input, including the seed, was identical." **Render again with a new seed**.

### Compare view (wireframe 09)

Purpose: judge 2 to 4 attempts of one shot side by side and pick the keeper.

- Opened from "Compare selected" in the Shot view. Full window, no sidebar. **Close** returns to the shot.
- **Layout:** 2-up, 3-up or 4-up. Each player shows attempt id, workflow chip, a KEEPER tag if it is the keeper, a one-line summary (turbo or full, duration, seed, age), and:
  - **Swap:** replace this attempt with another from the same shot.
  - **Set as keeper** (disabled and labelled "Current keeper" on the keeper).
  - **Load settings:** copies the attempt's workflow and values into the Shot view form.
- **Shared controls:** play/pause, seek bar and time, **Speed** (1x, 0.5x, 0.25x), **Sound from** (one attempt or none), **Loop**, and a **Play together** switch in the header that keeps all players on the same time.
- **What differs:** a table with one row per input whose value differs between the attempts, one column per attempt. Cells that differ from the first column are shaded. Inputs identical in all attempts are listed on one line ("Same in all: Prompt, Duration, ..."). Reference images and frame images compare by file.

### Library (wireframes 10, 11)

Purpose: keep prompts for reuse, and define the prompters that generate new ones. Two tabs. Presets are not part of the Library (see Open Decisions).

**Prompts tab (wireframe 10):**

- Search, tag filter pills (with counts), sort (default "Recently used"), **New prompt**.
- List of prompts: name, times used, first two lines of text, tags.
- Detail panel for the selected prompt: **Name**, **Prompt**, **Tags** (add and remove), **Note**, and **Use in shot**: a shot dropdown with **Replace its prompt** or **Add to its prompt list** (switches that shot to list mode if needed). Shows usage ("Used 9 times, last in ..."). **Save changes**, **Duplicate**, **Delete**.
- Prompts get into the Library with **New prompt**, or from a shot's prompt box with a "Save to Library" link (not drawn in the wireframes; add it when building).

**Prompters tab (wireframe 11):** a prompter turns a recipe into a list of prompts. Three types, chosen with a segmented control. All produce plain text prompts for the prompt list.

- **Template:** a template with `{slot}` placeholders (anything in braces becomes a slot). A table of slots: name, **how to pick** (Pick at random, Go in order, Always the same), values (one per line), count. Below: **Prompts to make**, a **randomness seed** with **New seed** (the same seed always gives the same list, so a batch can be rebuilt), **Avoid repeats**, and a **Preview** that generates a few samples.
- **LLM:** an instruction, an input (one idea per line, pasted when it runs, or the current shot prompt), an **endpoint** (an OpenAI-compatible chat API, such as a local server) and temperature, and **Test with one idea**. A note states that ideas are sent to this endpoint, not to the ComfyUI server.
- **Script:** a script file and a runtime (Python or Node). The app starts it as a child process, writes a JSON object to stdin (count, seed, current prompt), and reads a JSON list of prompts from stdout. **Test run** shows the output. The script runs with the user's own rights and only from a path the user chose.
- Each prompter has **Save prompter**, **Duplicate**, **Delete**. The Prompt list mode picks from this list.

### Projects (wireframe 15)

- The **Project switcher** at the top of the sidebar lists the projects with their shot counts. Menu: **New project**, **Rename project** (renames the folder), **Open project folder**, **Remove from list**.
- **New shot** (dialog, wireframe 15): opened from the **+** next to LOOSE SHOTS, or from **Add shot** in a Sequence view (then "Where" is preset). Fields: **Shot name** (default "Untitled shot"); **Where**: *Loose shot* (belongs to no sequence) or *In a sequence* with a sequence dropdown; **Workflow** (default the last used one). **Create shot** opens the new shot in the Shot view. A shot added to a sequence goes at the end. To change it later, use **Move to sequence** in the Shot view (loose to sequence, sequence to sequence, or back to loose).
- **New sequence:** the **+** next to SEQUENCES asks for a name, then opens the empty Sequence view with its **Add shot** button.
- **New project:** a name, and a read-only preview of its folder (`<workspace>/projects/<name>`). Names must be unique and file-system safe.
- **Remove from list** only forgets the project in the app. It never deletes the folder or its files. To bring it back, use **Open existing project...** (not drawn: add it to the same menu) and pick the folder.
- A project is self-contained (see Local Storage), so copying its folder to another workspace and opening it there works.
- Moving a shot to another project is not supported in the first version. Duplicate shot works inside a project only.

### Settings and first launch (wireframes 08, 13)

- **Settings screen (wireframe 13)**, opened from the sidebar, has two cards:
  - **Server:** server address, access token (optional, for a reverse proxy), **Test connection** ("Connected. 142 node types found", from `GET /object_info`). This is the same form as the first-launch connect step. The token is stored in the operating system's keychain, not in the settings file.
  - **Workspace folder:** its location with **Change folder** and **Open folder**, a one-line description of what it holds, and the warning not to use a synced folder (see Local Storage). Changing it moves nothing: the user picks an existing workspace or creates a new one.
- **First launch:** three steps shown as a bar: Connect, Import a workflow (the Import screen, with "Skip for now"), First project (name it; the folder preview shows where it will live). The workspace folder is created silently at the default location and can be changed in Settings. The import step is also what the app shows any time it has no workflows.

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
2. **Back online, jobs updated:** on launch and on reconnect the app compares its running attempts with the server's queue and history. A banner summarises ("While the app was closed, 1 attempt finished and 1 failed. 4 jobs are still waiting.") with the affected attempts and **Open shot** or **Details**. **Dismiss** closes it.
3. **Upload failed:** input files upload when Run is pressed. One failing file stops the whole run, so nothing half-queued is left behind. The failing slot is marked, with **Retry upload** and **Remove image**.
4. **Rejected when pressing Run:** the app validates first (minimum and maximum values, option still offered by the server, slot count within the workflow's maximum). If the server still rejects a job, its message appears on the field it came from. Nothing is queued, and a line states how many problems remain.
5. **Failed, cancelled and cached attempts:** see Attempt states.

Empty states (wireframe 08), each pointing to the next step:

- No projects: the first-launch "First project" step, or in the switcher a **New project** item.
- No sequences or shots in the project: "Start your first shot" with **New shot** and **New sequence**.
- A new shot: default values, and "No attempts yet. Fill in the inputs and press Run."
- Empty sequence: "Add the first shot". Play is off until a shot has a keeper.
- Empty Gallery: "Nothing rendered yet". A search with no results says "No renders match ..." with **Clear filters**. Filters stay visible so the cause is clear.
- Queue idle: "Nothing running, nothing waiting."

### Not designed yet

These are known gaps. Design them before building them:

- **Presets** (named sets of values): left out of the Library on purpose. "Duplicate shot" and "Load settings" cover most of the need. If wanted, they are a button in the Shot view, not a Library tab.
- **Loading states** (skeletons while the Gallery or a shot loads).
- Keyboard shortcuts and behavior at other window sizes.

### Out of scope

- Stitching or exporting a final edited video. The Sequence view only previews the keepers in order.
- Multiple users or cloud sync.

## Implementation Notes

### Build order and first checks

- **Spike first, kept simple.** Before building screens, write throwaway scripts from the ComfyUI source and docs (`server.py`, `execution.py`, the websocket API example) that connect to the server, queue one cheap job (turbo, short duration, low megapixels), follow its progress over the WebSocket, read `GET /history`, and download the result with `GET /view`. The scripts are temporary and can be deleted afterwards. Build the client layer from the same reading, and develop against a small fake ComfyUI server (plain HTTP and WebSocket that answers the routes in the table below, with scripted scenarios: progress, failure, out of memory, another client's job in the queue, offline, rejected upload).
- **Smoke test on the real server** as soon as the first job runs end to end: connect, run one job per workflow, see progress and the result. Fix any difference from the docs then. Items to check there: where a `SaveVideo` output appears in `/history`, whether `POST /queue` with a `delete` list works on this ComfyUI version, whether WebSocket works through the reverse proxy and token, and whether first-frame-only and text-to-video run correctly.
- **Milestones:** M1 connect, import, schema, run one job, show its attempt. M2 queue drawer, progress, Gallery. M3 sequences, keepers, Compare. M4 Library, prompters, prompt list mode. M5 states, polish.

### Interrupt rule

`POST /interrupt` stops whatever the server is running, including a job started by another client. So **Interrupt** in the Queue drawer, and **Cancel** on a running attempt card, must first check that the running job's `prompt_id` belongs to an attempt of this app (from `GET /queue`). If it is not ours, the button is not offered. Where the server supports interrupting a specific `prompt_id`, use that. Cancelling a waiting job removes only that job's id, and never uses a clear-all call.

### Output rules

- **Where:** inside the project folder, `<workspace>/projects/<Project>/outputs/`. Files are downloaded automatically when a job finishes (`GET /view`), never on demand later. Nothing is deleted from the server.
- **Layout:** `outputs/<Sequence name>/<NN Shot name>/attempt-<id>-<workflow>.<ext>`. Loose shots go under `outputs/_loose/<Shot name>/`. Names are made safe for the file system (illegal characters replaced, length limited).
- **Renaming:** each attempt's file path is stored in `project.db`, relative to the project folder. Renaming or moving a shot does not move existing files. New attempts use the current names.
- **Export keepers:** an action on the Sequence view that copies each shot's keeper to `outputs/_keepers/<Sequence name>/<NN Shot name>.<ext>`, numbered in sequence order, replacing earlier exports. It never moves or deletes the originals.
- **Thumbnails:** one still frame per attempt, made when the file is downloaded and stored with the project. Gallery sort order is newest first by default.
- These are defaults. If the agent finds a reason to change them, it records the change (see Record decisions).

### Record decisions as you go

The implementer keeps a short `docs/decisions.md`. Each entry is one or two lines: what was decided, why, and the date. It covers every choice the PRD leaves open (for example the SQLite schema, the LLM prompter's API shape, how images are named when uploaded, how the token is stored) and every place where the build differs from the PRD or the wireframes. When the code and this document disagree, the entry says which one is right.

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
| `POST /interrupt` | Stop the running job |

## Open Decisions (for later)

- Presets: whether to add them at all, and where (see Not designed yet).
- Projects: moving a shot between projects, project archive, and a per-project override of where renders are stored (for example a bigger drive).
- Import fl2vid only (covers t2v, i2v, fl2v) or import t2v as a separate tab too.
- Smoke test: `MiniMaxH3ImageToVideo` with only `first_frame` filled, and with both frames empty, sent from the app after removing the unused `LoadImage` nodes.
- Whether to add a "Vary" toggle on single inputs (duration, aspect ratio, turbo, seed) if repeating one change many times becomes a chore.
- LLM prompter: which API shape to support first (assumed OpenAI-compatible chat completions).
- "Save to Library" from a shot's prompt box (needed, but not drawn).
- Whether `POST /queue` with a `delete` list is available on the user's ComfyUI version (cancelling waiting jobs depends on it). Checked in the smoke test.
