# Wireframes

Low-fidelity wireframes for Comfy Toolkit, a desktop client for ComfyUI. They are a reference for **layout and structure**. They do not define behavior: for what each control does, see the "Features and UI" section of `PRD.md`.

## Screens

| PNG | Screen | PRD section |
|---|---|---|
| `png/01-shot-ref2vid.png` | Shot view with the ref2vid workflow | Features and UI > Shot view |
| `png/02-shot-fl2vid.png` | Shot view after switching to fl2vid (shared values kept, workflow-specific inputs swapped) | Features and UI > Shot view |
| `png/03-sequence.png` | Sequence view: shot cards with keepers, keeper timeline | Features and UI > Sequence view |
| `png/04-gallery.png` | Gallery: filters, grouped renders, detail panel | Features and UI > Gallery |
| `png/05-import-workflow.png` | Import workflow: file, exposed inputs, server checks, version diff | Features and UI > Import workflow |
| `png/06-queue.png` | Queue drawer: running job, waiting jobs grouped by run, other clients' jobs, recently finished | Features and UI > Queue drawer |
| `png/07-states-errors.png` | Error and connection states: offline, back online, upload failed, rejected run, failed/cancelled/cached attempts | Features and UI > States, Attempt states |
| `png/08-states-empty.png` | First launch (connect, import) and empty states | Features and UI > Server settings and first launch, States |
| `png/09-compare.png` | Compare view: 2 to 4 attempts, shared controls, what differs | Features and UI > Compare view |
| `png/10-library-prompts.png` | Library, Prompts tab | Features and UI > Library |
| `png/11-library-prompters.png` | Library, Prompters tab: Template editor, plus the LLM and Script variants | Features and UI > Library |
| `png/12-shot-prompt-list.png` | Shot view with the Prompt row in list mode and the run bar | Features and UI > Prompt list mode |
| `png/13-settings.png` | Settings: server, workspace folder | Features and UI > Settings and first launch |
| `png/15-projects.png` | Project switcher menu, new project dialog, and the workspace folder layout | Features and UI > Projects; Local Storage > Layout |
| `png/14-theme.png` | Light and dark colour tokens on a sample card, with the theme switch | Features and UI > Theme and colours |

## Source

`source/` holds the files the wireframes were drawn from: one `*.dc.html` per screen and `canvas.json` (the board layout).

- The `.dc.html` files use the design tool's own template tags (`sc-for`, `sc-if`) and inline styles, and expect that tool's runtime script (`support.js`). They do **not** render by themselves in a browser, and they are not code to port into React. Treat them as a precise text description of each screen's structure, labels and sizes.
- The PNGs are the easiest thing to look at.

## Caveats

- Sample data (names, seeds, counts, diffs) is made up. The workflow numbers (30 nodes, 22 node types, 5 models, 6 ref images) come from `video_minimax_h3_r2v.json`.
- The PNGs were rendered with a fallback font because IBM Plex Sans was not available, so text widths differ slightly from the original design.
- All screens are drawn in the light theme. The dark tokens are in `png/14-theme.png` and the PRD.
- Not drawn yet: presets, loading states, other window sizes, and the "Save to Library" link on the prompt box (described in the PRD).
- The Library, Compare, Queue and states boards are linked together in the canvas source, but the links only work in the design tool.
