# Backlog

Things that are wanted or undecided but not built. `docs/spec.md` describes only what the app does today. When an item ships, write its behaviour into the spec and remove it from this file.

## Features

- **Moving a shot to another project.** Today Duplicate shot and Move to sequence work inside one project only.
- **Project archive.**
- **Per-project output location**, for example a bigger drive, instead of always `<workspace>/projects/<name>/outputs/`.
- **Check the server against the imported workflows.** Today the missing node types and model files are checked only on the Import screen, against the server at that moment. When the app is pointed at a new or different ComfyUI server, nothing says which of the workflows already in the app it cannot run. Wanted: a check of every imported workflow (current versions) against the connected server's `object_info`, listing per workflow the missing node types (with the custom pack they likely come from, if known) and missing model files, and reusing the existing `checkWorkflow`. Open questions: when it runs (on connecting to a different server, from a button in Settings, or both), where it shows (a badge on the workflow in the shot's workflow picker, a Settings list), and whether Run should warn up front instead of waiting for the server to reject the job. The cached `object_info` is refreshed only on connect, so the check would need a refresh first after a pack is installed.

## Polish

- **Loading states:** skeletons while the Gallery or a shot loads.
- **Keyboard shortcuts.**
- **Other window sizes:** behaviour at small and very large windows has not been designed.
- **Gallery grid:** loads 60 renders at a time. Replace with a windowed grid if that becomes slow with many thousands of attempts.
