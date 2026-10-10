# Decisions

Log of choices made while building and the reasons for them. Newest last. `docs/spec.md` describes the resulting behaviour; when behaviour changes, the spec is updated in the same change and an entry is added here if the reasoning is worth keeping.

"The PRD" in entries up to 2026-10-08 is the original design document, which became `docs/spec.md` (the original text is in git history as `PRD.md`). Those entries are folded into the spec.

## 2026-10-08 (initial build)

- **Stack versions.** Electron 38, electron-vite 4, Vite 7, React 19, Tailwind 4 (`@tailwindcss/vite`), Zustand 5, better-sqlite3 12, TypeScript 5.9. Pinned to majors known to work together; newer majors (Vite 8, TS 7) were skipped on purpose. Main process builds as CommonJS (`__dirname`, native module).
- **shadcn/ui.** No shadcn CLI or Radix: a small set of shadcn-style components lives in `src/renderer/src/components/ui.tsx`, built on the PRD colour tokens (`clsx` + `tailwind-merge`). Same idea (copy-in components), fewer dependencies.
- **Tokens.** CSS variables on `:root` / `.dark`, mapped to Tailwind colours with `@theme inline` (`bg-panel`, `text-muted`, `bg-accent`...). Base element resets sit in `@layer base` so utilities win.
- **Theme.** `nativeTheme.themeSource` is set from the setting, and the renderer also applies the `dark` class directly for Light/Dark (Auto follows `prefers-color-scheme` live). Relying on `prefers-color-scheme` alone did not switch reliably.
- **Token storage.** The access token is encrypted with Electron `safeStorage` (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux) and stored as `token.bin` in the app data folder. `keytar` is unmaintained. If no OS encryption is available it falls back to plain bytes in the app data folder (never the workspace).
- **App settings** (server address, workspace path, theme, client id, current project) live in `settings.json` in the app data folder. The ComfyUI `clientId` is generated once and kept, so progress events for jobs queued before a restart still reach the app.
- **`object_info` cache.** The last `GET /object_info` is cached in the app data folder so schemas (options, ranges, optional inputs) work offline.
- **Schema is derived on every read** from `workflow.json` + `overrides.json` + cached `object_info` (never stored), as the PRD says.
- **Seed.** Literal `seed` / `noise_seed` integer fields are detected automatically and always driven by the shot's Seed control (Random/Fixed). They are not offered in "Not found automatically" (the wireframe shows Seed there with an Expose button; the PRD's Seed control makes that redundant). The Seed control is hidden for workflows without such a field. Random seeds are below 2^48.
- **Overrides format** (`overrides.json`): `{ inputs: { <candidate id>: { hidden, key, label, help, order, min, max, step, minCount, maxCount } }, expose: [ { class, title?, field, key?, label?, help?, order?, min?, max?, step? } ] }`. Candidate id = derived key; repeated keys get `key#2`, `key#3` (e.g. the two `Int` steps nodes in fl2vid). Exposed fields are matched by node class + normalised title, never by node id.
- **"Internal" primitives** (start unticked on import): a primitive whose every consumer input is `on_true` / `on_false` of a switch node. This catches the two Steps values without hard-coding titles.
- **Suggested fields** in "Not found automatically": `prompt, text, negative(_prompt), aspect_ratio, megapixels, width, height, steps, cfg, length, duration, num_frames, batch_size`, plus any multiline string. "Show all fields" lists every literal field.
- **File inputs default to empty**, not to the filename baked into the export (that file lives only on the server). A required file must be picked before Run.
- **Optional unknown.** Without server info, a LoadImage input is treated as optional; the server reports it if not.
- **File group key** is the group prefix (`ref_images`), not `ref_images.ref_image_N`. Slot bounds come from `object_info` (any numeric `min`/`max` in the input's options, or the length of a `names` list); without it, min is 1 if required and max is the number of slots in the export. New slots clone the first LoadImage under the next free integer id.
- **Input images** are copied to `inputs/<first 20 hex of sha256>.<ext>` and uploaded under that name with `overwrite=true`. Uploads are remembered per server in `project.db` (`uploads` table), so a file is uploaded once per server.
- **"Nothing half-queued".** Run validates, uploads, then posts the jobs. If any `POST /prompt` fails, already-queued jobs of that Run are removed by id (`POST /queue` delete, or a targeted interrupt if one already started) and their attempt records are deleted.
- **Rejected run errors** are mapped onto fields through the schema targets (node id + `extra_info.input_name`); anything unmapped is listed in the message line.
- **Attempt ids.** `#N` shown in the UI is per shot (`num`); the database id is global to the project.
- **Progress percent.** 0–5 % while nodes before sampling run, 5–95 % from `progress` events (sampler steps), 96 % after sampling, 100 % when downloaded. ComfyUI has no overall progress, so this is an estimate.
- **Cached detection.** An attempt is CACHED when every output node of the job appears in `execution_cached`. The (identical) output file is still downloaded so the attempt has its own file.
- **Recently finished** in the Queue drawer is kept in memory (last 50) for the session.
- **Jobs that leave the queue without an event** (removed by another client) are checked against history after 10 s and marked cancelled ("Removed from the queue before it started") if there is no record.
- **Reconcile summary** is held in the main process until the window collects it (reconcile can finish before the window listens).
- **Retry** re-runs the attempt's stored values with the *current* version of its workflow and the same seed. "Render again with a new seed" does the same with a random seed. (Re-sending the stored final JSON was not used: it cannot pick up re-uploaded inputs.)
- **Load settings** copies workflow + values and puts the attempt's seed in the seed field without changing Random/Fixed. If the attempt came from a list run, the Prompt row switches to single with that prompt.
- **Thumbnails** are made in the renderer with the bundled Chromium (`<video>` → canvas → JPEG, 480 px max) and stored at `thumbs/attempt-<id>.jpg` in the project; the video duration is recorded at the same time for the keeper timeline. No ffmpeg dependency. Media is served through a `ctmedia://` protocol restricted to the workspace and known project folders, with HTTP Range support for seeking.
- **Hand-edited workflows.** If `workflow.json` changes on disk without an import, the next read records it as a new version (new hash) so attempts still say which version they ran. Folders found in `workflows/` but missing from `app.db` (e.g. after a git clone) are indexed automatically.
- **Editing a workflow** (Settings, or Edit workflow in a shot) reuses the import screen on the stored file: it changes the name and `overrides.json` only, so the version and hash stay. **Deleting** moves `workflows/<id>/` to the system trash and drops the index row; `workflow_versions` rows stay so a later import under the same id continues the numbering. Shots that used it fall back to the first workflow; attempts keep their record.
- **Old versions** are kept as files in `workflows/<id>/versions/<N>/` when a new version is imported.
- **SQLite schema.** `app.db`: `meta`, `workflows`, `workflow_versions`, `projects`, `prompts`, `prompters`. `project.db`: `meta`, `sequences`, `shots` (values JSON, prompt list, seed mode, runs, keeper, next attempt number), `attempts` (values, seed, status, prompt id, server URL, run id and indices, final JSON, outputs JSON, thumb, duration, error JSON, timestamps), `inputs`, `uploads`. WAL mode.
- **Gallery paging.** "Virtualized" is implemented as paged loading (60 at a time) with an intersection observer and lazy thumbnails; enough for thousands of attempts. Revisit with a windowed grid if needed.
- **LLM prompter.** OpenAI-compatible `POST {endpoint}/chat/completions`, instruction as the system message, one call per idea. Added a **Model** field and an optional **API key** (stored in `app.db` with the prompter; the PRD's wireframe has neither). In "current shot prompt" mode it makes N variations of the shot prompt.
- **Template prompter in a shot.** Generate uses the prompter's saved seed, so a list can be rebuilt; change the seed in the Library ("New seed") for a different list. The first letter of each prompt is capitalised.
- **Script prompter** runs `python3` (`python` on Windows) or `node`; override with `COMFY_DIRECTOR_PYTHON` / `COMFY_DIRECTOR_NODE`. 60 s timeout.
- **Deleting.** Added "Delete shot", "Delete sequence" (its shots become loose) and "Delete" on attempt cards (not in the PRD). Deleting never removes rendered files. Running/queued attempts must be cancelled first.
- **Renaming a project** is refused while it has queued or running jobs (their downloads write into the folder).
- **Workspace via env.** `COMFY_DIRECTOR_WORKSPACE` and `COMFY_DIRECTOR_USER_DATA` override the workspace and app data folders (used for testing).
- **Not built (PRD "Not designed yet"):** presets, loading skeletons, keyboard shortcuts.
- **To verify on the real server** (PRD smoke test): `POST /queue` delete support (the app reports when a waiting job is not removed), targeted `POST /interrupt {prompt_id}`, where `SaveVideo` outputs appear in `/history` (the app takes every `{filename, subfolder, type: output}` entry under any key), WebSocket through the reverse proxy (the token is sent as `Authorization: Bearer`), and `MiniMaxH3ImageToVideo` with first frame only / no frames.

## 2026-10-08 (review feedback)

- **Prompt on a regular node is discovered.** A literal text `prompt` field on a regular node (fl2vid, t2v: `MiniMaxH3ImageToVideo.prompt`) is now an auto-discovered input, ticked by default, instead of needing an Expose override. This replaces the PRD's "must be exposed through the overrides layer"; the code is right. Older overrides that expose the same field are not added twice.
- **Repeated titles no longer block an import.** When exposed inputs derive the same key (two nodes titled `Int`), each gets a unique key automatically: the label if the user renamed it (`full-steps`), otherwise the key numbered in workflow order (`int`, `int#2`, `int#3`), matching the candidate ids in `overrides.json`. (An earlier version named them after the input they feed, `steps on_false`; dropped as confusing.) Only keys typed explicitly can still clash, and those are still flagged. This replaces the PRD's "the Import screen flags it and asks for a rename"; the code is right.
- **Resolved keys are saved.** On import, any key the app resolved itself (repeated titles) is written to `overrides.json` as an explicit `"key"`. Renaming a label later only changes the text in the form; the key that shots store values under stays fixed.

## 2026-10-08 (pre-merge review)

- **Output file names use the project-wide attempt id**, `attempt-<id>-<workflow>.<ext>` as in the PRD, not the per-shot `#N` shown in the UI. Shot names are not unique, so two shots can share an output folder and per-shot numbers collided there. If the name is still taken (ids can be reused after the newest attempt is deleted), ` (2)`, ` (3)`... is added: a rendered file is never overwritten. Files written before this change keep their names.
- **A failed history request is not "no record".** During reconcile and the missing-job check, a request error leaves the attempt as it is and the app asks again (reconcile after 5 s, otherwise on the next queue poll). Only an answered, empty history marks the job failed or cancelled.
- **A `workflow.json` that is not valid JSON is skipped** in the workflow list, like an unreadable file, instead of breaking the list.
- **Remembered uploads are checked by the server, once.** If the server rejects a Run on a file input and the app had skipped uploading that file (remembered from earlier), it forgets those uploads, uploads again and posts the Run a second time. A second rejection is shown as usual. This covers a server whose input folder was emptied.
- **Attempts sent to another server address** stay untouched while that address is not the one in Settings (they are picked up again if it comes back). Cancel on such an attempt marks it cancelled locally and says the job was not cancelled on that server; after that it can be deleted and the project renamed.
- **Downloads are tried three times.** When fetching the result fails on a request error, the attempt stays active and reconcile runs again after 5 s (or on reconnect); the third failure marks it failed. All output files of a job are fetched before any is written.
- **"Nothing half-queued" is checked, not assumed.** After a failed Run the app reads the queue again. Jobs the server did not give back keep their attempts and the message says how many will still run, instead of "Nothing was queued". If the queue cannot be read, the jobs are kept and the queue poll settles them.
- **Verified on the real server (2026-10-08, by duyyudus):** cancelling a waiting job (`POST /queue` delete), interrupting a running job, and `MiniMaxH3ImageToVideo` with a first frame only and with no frames. `SaveVideo` outputs are found in `/history` and downloaded (the video appears in the Gallery and plays), and the WebSocket connects (the app only allows Run once it is open). Not confirmed separately: the WebSocket through a reverse proxy with a token, if the test reached the server directly.
- **Retry makes a new attempt.** Retry on a failed or cancelled attempt queues a new attempt with the next `#N` and leaves the old record as it is. ComfyUI cannot continue an interrupted job, so the render starts from the first step either way.

## 2026-10-09 (PRD becomes the spec)

- **`PRD.md` moved to `docs/spec.md` and now describes the app as built.** The decisions above that replaced or filled in PRD text were written into it, so one file says what the app does. The build-time sections (build order, milestones, "Record decisions as you go") were removed, and "Not designed yet" and "Open Decisions" moved out to `docs/backlog.md`: a spec that also lists unbuilt ideas cannot be trusted as a description of the app.

## 2026-10-09 (text size)

- **Text size scales text only, not the whole window.** The setting drives one CSS variable, `--font-scale` (body size / 14), and every text size is a Tailwind token multiplied by it (`text-13`, `text-xs`... in `styles.css`). Electron's zoom factor was the smaller change but also grows spacing, panels and thumbnails, which costs room for media. Components must use the tokens, not `text-[13px]`, or that text will not scale.
- **Default is 15 px**, up from the fixed 14 px the wireframes use. Existing installs get 15 too, since nothing was stored before.

## 2026-10-09 (reset workspace)

- **Reset moves folders to the system trash, it does not erase them.** Same as deleting a workflow: one wrong click on gigabytes of renders stays recoverable. Disk space is freed when the user empties the trash.
- **The confirmation is asked by the main process** (a native message box, Cancel as default), not by the Settings screen, so no caller of `resetWorkspace` can delete without it.
- **The prompt library and prompters survive both choices.** They belong to neither projects nor workflows, and the request was for those two. Deleting `app.db` outright would have taken them along.
- **Projects outside the workspace are only forgotten.** Reset is about the workspace folder; deleting a folder somewhere else on disk from a button named "Reset workspace" would be a surprise.
- **Refused while jobs are queued or running**, like Rename project: a download finishing during the reset would write into a folder that is being removed.

## 2026-10-09 (app icon)

- **The icon shows what the app does, not ComfyUI's graph editor:** a stack of frames (many takes of a shot) with one link between two ports on the front frame (the workflow that made them). It uses the accent blue and the paper `panel` colour so it matches the app in both themes.
- **Icon files live in `resources/`, not electron-builder's default `build/`,** because `.gitignore` ignores `build/`. `buildResources` points there, and `resources/icon.png` is also shipped in the package because the window loads it at run time.
- **`icon.svg` is the source; the PNG and ICO are rendered from it by Electron** (`npm run icon`), so no image library was added.

## 2026-10-09 (renamed to Comfy Director)

- **The app is now Comfy Director** (was Comfy Toolkit): the name says what the user does with it, directing shots, rather than describing a bag of tools. Product name, package name (`comfy-director`), app ID (`com.comfydirector.app`), installer name, default workspace (`~/Comfy Director`) and the `COMFY_DIRECTOR_*` environment variables all changed together.
- **No migration code.** Nothing has been released, so the one existing install is moved by hand: rename the app data folder to `Comfy Director` and uninstall the old build (the new app ID makes the installer treat it as a different app). A workspace path already stored in `settings.json` keeps working.
- **Internal identifiers stay** (`window.toolkit`, `ToolkitApi`, `ctmedia://`): they are never shown to the user and renaming them is churn.
- **The wireframe PNGs still show the old name.** They are a layout reference only; the sources are updated and the PNGs change at the next export.

## 2026-10-09 (resolution as a standard input)

- **`ResolutionSelector.aspect_ratio` and `.megapixels` are discovered automatically,** like a prompt typed on a node. Before, each had to be exposed by hand per workflow, so a workflow where that step was skipped lacked a control the others had, and the shot form showed it as if it belonged to one workflow.
- **Matched by node class and field, not by field name alone** (`STANDARD_FIELDS` in `discover.ts`). A field called `megapixels` on an unknown node may mean something else, so those stay under "Not found automatically" as suggestions.
- **They can still be unticked on import,** and an older `overrides.json` that exposes the same field is skipped rather than added twice. Any label, key or range set on that old entry no longer applies.
- **The divider in the shot form now reads "Other inputs"** (was "<workflow> only"): the group is every input whose key is not in all workflows, which says nothing about it being unique to one.

## 2026-10-09 (editable defaults)

- **An input's default can be changed on the Import / Edit workflow screen** and is saved as `default` in `overrides.json`. Before, the only way was to edit the graph in ComfyUI and re-import. The workflow file is never rewritten, so the hash and version stay the same and the graph's own value remains the fallback.
- **Only a default that differs from the graph is saved,** keeping the overrides file to exceptions. A number field left empty saves nothing.
- **Attempts now record the defaults they ran with** alongside the shot's own values (file inputs excluded). Editing a default does not create a new workflow version, so without this an old attempt's settings and its re-run would silently follow the new default. Attempts made before this change still hold only the shot's own values; their exact graph is in the stored final JSON.

## 2026-10-09 (prompting skills and prompt chat)

- **A skill belongs to a workflow type, not to one workflow or one prompter.** One guide covers every workflow of a model family (`minimax_h3` for `minimax_h3_r2v` and `minimax_h3_fl2v`). The type is just the folder name under `prompter/skills/`; there is no table of types and no field on the workflow. The only link to workflows is a naming convention: a type that starts the workflow's id makes its prompter the default in that workflow's Prompt chat.
- **Skills are plain files, like workflows,** so they can be hand-edited and versioned with git, and are read from disk on every request. Only `skill.md` is copied: the example skills are single flat files, and a skill that points at sibling files would need the LLM to open them, which a chat completion cannot do.
- **The skill is sent whole as the system message, never summarised or retrieved in parts.** The request was that the LLM reads all of it. The cost (about 15k tokens per request for the MiniMax H3 guide) is shown next to the skill, because a small local model's context would silently drop the end.
- **The chat is its own panel in the Shot view, between the form and the attempts,** not a dialog or a separate screen. It was first built as a switch with the Attempts panel and moved on request: the loop is prompt, render, look, revise, so the prompt box, the conversation and the attempts all have to be on screen. Three columns are tight at the default window width, so the panel can be closed and the Attempts column narrows while it is open.
- **One conversation per shot, stored in `project.db`,** because it is the revision history of that shot's prompt and should travel with the project folder.
- **The chat reuses LLM prompters** (endpoint, model, key, skill, instruction) rather than adding a second place to configure an LLM.
- **Prompts come back in fenced code blocks.** A fixed line in the system message asks for it, and the app turns each block into a card with Use as prompt. This matches how the skill files already format prompts, and keeps the explanation readable without parsing it.
- **Images are numbered across the whole chat and the numbers are sent with them,** so "Image 3" means one picture for the user, the LLM and the prompt (`@image3`), whichever message it was attached in.
- **Chat replies are streamed; list generation is not.** With a 15k-token skill a reply takes long enough that watching it arrive matters, and Stop saves a turn that is going the wrong way. The main process reads the event stream and forwards each piece as a `chat-delta` event; the stored message is still written once, at the end. A stopped reply is kept, because the part that arrived is usually worth answering.
- **Chat messages are rendered with `react-markdown`** (plus `remark-gfm` for tables and `remark-breaks` so typed line breaks survive) rather than a hand-written parser: replies use tables and nested lists, which is where small parsers go wrong. It builds React elements and never injects HTML, and the image element is replaced by its alt text so a reply cannot make the app fetch an address the LLM chose. Fenced blocks in a reply are still cut out first and shown as prompt cards, unformatted, because a prompt is copied literally.
- **List generation now takes the first fenced block of a reply as the prompt.** Skill-driven models wrap prompts in fences; a reply without one is used whole, as before.

## 2026-10-09 (video and audio references)

- **`LoadVideo` and `LoadAudio` are file inputs like `LoadImage`.** The MiniMax H3 reference-to-video node takes reference videos and audio as well as images, and the form showed only the images because discovery knew one loader class.
- **A reference video is one input, although it fills two sockets.** In ComfyUI a video reaches the node as frames (`IMAGE`) and its soundtrack as a separate `AUDIO` input, both from one `Get Video Components` node. Showing `ref_video_audios` as its own control would let the two go out of step, and there is nothing to pick for it: it is the audio of the video already chosen.
- **Discovery looks through `Get Video Components` only** (`UNPACKERS` in `discover.ts`), not through any node between a loader and its consumer. A resize or crop node in between is a real processing step whose consumer input says nothing reliable about the file, so such a loader stays a plain file input named after the node it feeds.
- **Video and audio files are limited to formats the app can play back** (MP4, MOV, WEBM; WAV, MP3, FLAC, OGG, M4A), so every slot has a working preview. The server accepts more.
- **A video without an audio track still links its audio slot.** The app does not inspect the file, so it cannot leave the link out. Not yet run on the real server.

## 2026-10-10 (confirmations)

- **Confirmations go through `api.confirm`, a native message box opened by the main process, not `window.confirm`.** On Windows, Electron leaves text fields unable to take keyboard focus after `window.confirm` closes, until the window loses and regains focus: after deleting a shot the Rename project field could not be typed in. A message box from the main process does not have this.
- **Delete sequence asks what to do with its shots in the same dialog** (`api.choose`: Keep shots, Delete shots too, Cancel). Two dialogs in a row would leave it unclear whether cancelling the second still deletes the sequence. Keep shots is the default button, since it is the choice that loses nothing.

## 2026-10-10 (server files)

- **Server files are managed through our own companion node,** `comfyui-node/comfy_director_files`. ComfyUI has no route that deletes an input or output file and only partial ways to list them (`object_info` for the top of `input/`, `history` for recent outputs). The alternatives were a third-party node (the two found are small one-author projects built for other apps, one of them rooted at the whole ComfyUI install) or SSH/SFTP (a second set of credentials and a path to configure per server). A node of about a hundred lines that reaches three folders is smaller than either dependency.
- **The node is optional.** Everything else in the app works against a stock server; only the Server files screen needs it, and it says so when the node is missing.
- **Only `input/`, `output/` and `temp/`,** each resolved through ComfyUI's `folder_paths`, and every path checked to stay inside. Models and custom nodes are deliberately out of reach: a delete route on a networked server should not be able to do more than the screen offers.
- **No protection of its own.** The server's other routes (queue a job, upload a file) are equally open, so a separate secret for this node would add setup without changing who can reach the server.
- **Deleting is permanent and confirmed once,** by a native dialog naming the count, size and server. The server has no trash to move files to.
- **Deleting a ref forgets its upload in every project.** The Run would recover anyway (a rejected file input is uploaded again once), but forgetting avoids a rejected first try.
- **Deleting a rendered file resets ComfyUI's node cache,** from the node, through the same queue flag `POST /free` uses, with model unloading turned off. ComfyUI replays a cached output node's result without looking at the disk, so render, delete, identical rerun ended in a "cached" attempt whose file could not be downloaded. The cache cannot be cleared for one file only; the cost is that the next job recomputes every node once. Recovering in the app (noticing the 404 and rendering again) was the alternative, but it would still need the same reset to get past the cache.
- **Previews go through the main process** as `ctmedia://server/` URLs, because the renderer never talks to the server and must not hold the token. Range headers are passed on so a long video can be seeked without downloading it whole.
- **Thumbnails are made on the server, by the node.** The other ways to show a picture per row were ComfyUI's `/view?preview=`, which re-encodes an image at full size and does nothing for video, or loading every video in the list into a `<video>` element to grab a frame, which downloads the start of each file. A route that answers a 256-pixel JPEG keeps a list of hundreds of rendered videos light. Pillow and PyAV are already ComfyUI requirements, so the node still installs by copying a folder. The node keeps thumbnails in memory only: writing a cache folder on the server would add files to a screen whose purpose is removing them.
- **No "safe to delete" marking yet** (which outputs are already downloaded, which refs no shot uses). The list shows every file in the folder, including other clients' files.
