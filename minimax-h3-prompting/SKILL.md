---
name: minimax-h3-prompting
description: Write, review, and fix prompts for the MiniMax H3 video model (text-to-video, image-to-video with first/last frame, multimodal reference-to-video, video-to-video motion transfer and editing, native dialogue and audio). Use when the user asks for a MiniMax H3 / Hailuo H3 prompt, a shot plan or storyboard for H3, a product ad, UGC ad, music video, UI/game animation or dialogue scene generated with H3, the six-part full-reference format (subject_definitions, retention_analysis, ...), or help diagnosing a failed H3 generation.
---

# MiniMax H3 prompting

H3 generates short video clips with native stereo audio from text plus optional image, video, and audio references. The whole method reduces to one idea: **give H3 less to guess.** A good prompt states what matters, what changes, and what stays the same. Longer prompts help only when they add control.

Detailed material lives in `references/`:

| File | Read it when |
| --- | --- |
| [references/full-reference-format.md](references/full-reference-format.md) | The workflow accepts the structured six-part format, or several assets have different jobs in one generation |
| [references/workflows.md](references/workflows.md) | Writing for a specific use case: product ad, UGC ad, localized ad, UI/game, music video, dialogue, motion transfer, video edit, multi-clip film |
| [references/example-prompts.md](references/example-prompts.md) | You want a tested prompt to adapt rather than starting from the formula |

## Limits

| Setting | Value |
| --- | --- |
| Clip duration | 4–15 s per generation (longer pieces are edited from several clips) |
| Resolution | 768P or 2K — use 768P for tests, 2K once the shot is approved |
| Aspect ratio | 16:9, 9:16, 1:1, 4:3, 3:4, 21:9, or adaptive |
| Reference images | Up to 9 — JPG, JPEG, PNG, WEBP, HEIC, HEIF |
| Reference videos | Up to 3, 2–15 s each, 15 s combined, 50 MB each — MP4 or MOV, H.264 or H.265, 23.976–60 fps |
| Reference audio | Up to 3, 2–15 s each, 15 s combined — WAV or MP3 |
| All references | Up to 12 files per request |
| Text prompt | Always required, even with references |

Mode constraints:

- **First/last-frame and multimodal reference are separate modes.** A first or last frame cannot be combined with reference images, videos, or audio in one request.
- In first/last-frame mode the output follows the input image's aspect ratio. Reference-to-video lets you choose the ratio.
- The sources disagree on audio-only references: the main prompt guide says audio needs at least one image or video alongside it, while one FAQ says audio alone works. Pair audio with an image or video to be safe.
- An audio reference guides vocal or sound qualities; it does not guarantee an exact voice copy.
- Video-to-video interprets the source; it is not frame-by-frame tracking.

## Step 1: pick the mode

| Goal | Mode |
| --- | --- |
| Create the whole scene from a description | Text-to-video |
| Animate one static image | Image-to-video (first frame) |
| Lock both the opening and the ending composition | First + last frame |
| Preserve a character or product across shots | Multi-image reference |
| Combine identity, location, motion, and sound | Reference-to-video (image + video + audio) |
| Copy body movement or camera behavior | Video reference |
| Replace a subject but keep the motion | Video-to-video |
| Change one element of existing footage | Video edit with a narrow instruction |
| Follow music, vocals, or rhythm | Audio reference |

Use the smallest reference set that removes the important uncertainty. If one image already says everything, image-to-video is enough.

## Step 2: write the prompt

Base formula:

```
Subject + action + scene + lighting + camera + visual style + sound + constraints
```

Fill-in template:

```
[Visual style and lighting]. [Subject] is in [scene].
[Subject] performs [clear action in chronological order].
The camera uses [framing] with [one main camera movement].
Sound includes [dialogue, ambience, physical sounds, or music].
Preserve [important identity or product details].
Avoid [unwanted text, objects, motion, artifacts, or style changes].
End with [final pose, composition, or action].
```

For a multi-stage or reference-heavy shot, use the director structure instead:

```
Goal: Create a 15-second product video.
References: @Image1 defines the product. @Video1 provides motion only.
Keep Fixed: Product shape, logo, character face and outfit.
0–5s: Character enters and picks up the product.
5–10s: Slow push-in during product use.
10–15s: End on a clean hero shot.
Audio: Natural ambience and subtle product sound.
Avoid: Product deformation, extra people, identity changes, unnecessary cuts.
```

Rules that apply to every prompt:

1. **Write in playback order.** Describe what the viewer sees and hears as it happens: first, second, last.
2. **One shot, one job.** Each generation introduces a character, reveals a product, shows an interaction, transfers a motion, connects two scenes, or lands a hero shot. If the shot needs a long explanation, simplify the shot.
3. **One camera idea per shot.** Use standard terms: push in, pull out, pan, tilt, truck, pedestal, arc, tracking, static.
4. **Separate constants from changes.** Not "keep the character consistent" but "Keep the same face, hair and outfit. Change only the pose and camera angle."
5. **Lock identity before style.** Character → product → brand first; cinematic, luxury, neon, experimental after.
6. **Turn emotion into visible behavior.** Not "she feels nervous" but "she checks her watch twice, taps her fingers against the folder, takes a short breath, and looks toward the closed door."
7. **Cut unnecessary physical actions.** Long chains of hand–object–face interaction are the highest failure risk. Start at the moment that carries the message.
8. **State the ending.** Name the final pose, composition, or hold.
9. **Keep shot count realistic** for the duration. Timings are direction, not frame-accurate commands; if the ending compresses, remove an earlier event.

Use timelines (`0–3s`, `3–7s`, `7–11s`, `11–15s`) whenever a clip has several visual states: ads, UI animation, music videos, game sequences.

## Step 3: assign references

Every uploaded file gets exactly one stated job. Refer to files by the names the tool shows (`@image1`, `@video1`, `@audio1`; some tools use `@Image 1`).

| Input | Carries |
| --- | --- |
| Image | Appearance: identity, wardrobe, product, location, layout, keyframe |
| Video | Behavior: motion, timing, camera, perspective, interaction |
| Audio | Sound: voice quality, music, rhythm, atmosphere |
| Prompt | Intent: what to do with all of the above |

```
Use @image1 for the character's face and hairstyle.
Use @image2 for the clothing and color palette.
Use @image3 for the location and lighting.
Use @video1 for walking motion and camera timing.
```

Reference-prompt structure:

```
Reference role + Preserve + Transfer + Change + Final scene
```

> Use Image 1 for the character's face and outfit. Use Video 1 for body movement and camera timing. Preserve the character's identity and clothing. Transfer the running action into a rainy futuristic street while keeping the same tracking-camera rhythm.

Guidelines:

- **Let references carry information.** Do not re-describe what a reference already shows; add only the details that need special protection. Five strong model photos plus a three-sentence prompt worked for a five-person runway.
- **Restrict a reference's scope explicitly** when it could bleed: "@Video1 provides hand motion and timing only", "keep everything outside the panel unchanged".
- **Check references against each other.** Two images that disagree about clothing, proportions, or environment for the same subject create drift. Remove one or state which feature comes from which file.
- **Show details you do not want invented.** A character pack of front portrait, side view, full body, and accessory close-up beats repeated description.
- **Use standalone images, not composite boards**, unless the board is the point; otherwise grids and labels can leak into the output. When you do use a sheet, say what each region controls.
- **Label multiple characters** with a stable name plus a visible trait and reuse that label every time.
- For a simple motion reference, record a clean static-camera clip with one clear action. Heavily edited clips are hard to follow.
- Use only assets you own or have permission to use, including faces and voices.

First/last frame: describe the change between the frames, not just the endpoints.

```
Opening state → action begins → visible transition → ending state
```

> Begin exactly from @image1. The closed umbrella rises as the runner slides upward and the ribs spread. End in the final pose shown in @image2.

To continue a clip with tight continuity, extract its final frame and use it as the next clip's first frame.

## Step 4: sound and dialogue

- Write exact dialogue in quotation marks and name the speaker beside every line. Put delivery and movement outside the quotes.
- Keep lines short enough to leave room for breath and reactions. Read the line aloud at the intended pace; never fix overflow by asking for faster speech.
- Place physical sounds next to the action that causes them: "The cup touches the saucer with a light click as the espresso machine releases a short burst of steam."
- Describe music by mood, instrumentation, tempo, and timing. Say "no music" when you want none.
- For non-English speech, write the line in the target language and name the language; directions can stay in English.
- For exact subtitles or on-screen legal copy, add them in an editor afterward.

Dialogue template:

```
In [setting], [named character] says, "[exact line]," in a [voice quality] voice at a [pace] pace.
While speaking, [one simple action]. [Other character] listens silently and [brief reaction].
The camera [one clear direction].
```

Two-speaker scenes, voiceover, and lip-sync troubleshooting are in [references/workflows.md](references/workflows.md#dialogue-and-voiceover).

## Step 5: produce in stages

```
Plan → Lock → Test → Generate → Review → Fix
```

1. **Plan** the shot goal and, for anything longer than 15 s, the edit: a sequence of clips, each with one purpose, a defined start, a defined end, and only the references it needs. Define the opening image, major action, and final pose before the shots that connect them.
2. **Lock** the constants and approve every reference before reusing it. A generated reference image is a draft until its face, age, clothing, product shape, props, colors, and environment are checked.
3. **Test the hardest shot first** at 768P: hand–object interaction, fast motion, multiple characters, product operation, complex camera movement, motion transfer.
4. **Generate** the approved shots. Add one new reference or shot at a time.
5. **Review against the plan**, not just for beauty: correct character, action, product, duration, camera, ending.
6. **Fix only the layer that failed**; regenerate that clip, not the whole sequence.

Incremental build order for a single shot: subject, scene, lighting, and style → main action → one camera direction → dialogue, sound, or music → additional references → final resolution.

## Troubleshooting

| Problem | Check first | Fix |
| --- | --- | --- |
| Story is unclear | Shot structure | Give the shot one job; split into more shots |
| Character changes | Character reference | Clean identity references; name the fixed traits; reuse one label |
| Product changes shape or color | Product reference | Remove the conflicting image; name the exact feature that must stay fixed |
| Mechanism moves wrongly | Detail reference | Supply a photo of the real connection; request one physically plausible action |
| Action breaks | Motion complexity | Remove secondary actions; start closer to the key moment |
| Camera unstable | Camera instruction | One movement per shot; remove conflicting terms |
| Ending wrong or rushed | Final-frame plan | Remove an earlier event; no camera move during the final hold; consider a last frame |
| Too much happens | Scope | Cut actions or divide into clips |
| Text distorted or missing | Copy length | Shorten, show fewer lines, steady the composition; otherwise add text in an editor |
| Grid or reference board appears | Composite references | Use standalone images; say to borrow appearance, not layout |
| Wrong character speaks | Speaker labels | Name plus visible trait beside each line; one line per person |
| Both mouths move | Listener direction | State the listener's closed mouth and silent reaction; else separate shots |
| Dialogue cut off | Line length | Shorten the line or lengthen the clip |
| Lip sync off | Complexity | Shorter line, clearly visible face, steady camera, fewer gestures |
| Voice differs between clips | Voice description | Reuse identity and a concise voice description; for a narrator, lay one continuous track in the edit |
| Style swallows the subject | Layering | One hero visual idea per moment; restate the visual anchor |
| Music drops out early | Audio length | Use a continuous segment that covers the full clip |

## Pre-flight checklist

- The main subject is clearly identified.
- Every uploaded file has a stated role, and no two compete for the same role.
- Fixed details and allowed changes are both named.
- Actions appear in playback order and fit the duration.
- Each shot has one main camera idea.
- Dialogue is short, quoted, and assigned to a named speaker.
- Sound is tied to visible events.
- The ending has a clear composition.
- Conflicting instructions have been removed.
- The hardest action has been tested.

For commercial work, also verify before publishing: packaging, color variant, logo, scale, correct product usage, that spoken claims match verified facts, and that the offer in the CTA is valid.

## Sources

Distilled from the guides at minimax-h3.com: the prompt guide, best practices, reference-to-video, full-reference prompt guide, director workflow, dialogue guide, commercial video guide, product ads guide, and music video guide. Several examples in those guides are labelled by their authors as suggested starting points rather than tested results; [references/example-prompts.md](references/example-prompts.md) marks which are which.
