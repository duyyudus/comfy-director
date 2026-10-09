---
name: minimax-h3-prompting
description: Write, review, and fix prompts for the MiniMax H3 video model (text-to-video, image-to-video with first/last frame, multimodal reference-to-video, video-to-video motion transfer and editing, native dialogue and audio). Use when the user asks for a MiniMax H3 / Hailuo H3 prompt, a shot plan or storyboard for H3, a product ad, UGC ad, music video, UI/game animation or dialogue scene generated with H3, the six-part full-reference format (subject_definitions, retention_analysis, ...), or help diagnosing a failed H3 generation.
---

# MiniMax H3 prompting

H3 generates short video clips with native stereo audio from text plus optional image, video, and audio references. The whole method reduces to one idea: **give H3 less to guess.** A good prompt states what matters, what changes, and what stays the same. Longer prompts help only when they add control, and more specification is not more control: a constraint that implies a boundary can manufacture the very discontinuity you were trying to prevent.

Later sections of this file hold the detailed material:

| Section | Read it when |
| --- | --- |
| [The six-part full-reference format](#the-six-part-full-reference-format) | The workflow accepts the structured six-part format, or several assets have different jobs in one generation |
| [Workflows by use case](#workflows-by-use-case) | Writing for a specific use case: product ad, UGC ad, localized ad, UI/game, music video, dialogue, motion transfer, video edit, multi-clip film |
| [Example prompts](#example-prompts) | You want a tested prompt to adapt rather than starting from the formula |

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
- Whether audio can be the only reference is unclear: the published guidance contradicts itself. Pair audio with at least one image or video to be safe.
- The minimum duration is stated as 4 s in some places and 5 s in others. Treat a 4 s clip as tool-dependent.
- An audio reference guides vocal or sound qualities; it does not guarantee an exact voice copy.
- Video-to-video interprets the source; it is not frame-by-frame tracking.

## Step 1: pick the mode

| Goal | Mode |
| --- | --- |
| Create the whole scene from a description | Text-to-video |
| Animate one static image | Image-to-video (first frame) |
| Lock both the opening and the ending composition | First + last frame |
| Preserve a character | Multi-image reference |
| Combine several visual assets | Reference-to-video |
| Combine identity, motion, and sound | Reference-to-video (image + video + audio) |
| Copy body movement or follow camera movement | Video reference / video-to-video |
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
3. **One camera idea per shot.** Use standard terms: push in, pull out, pan, tilt, truck, pedestal, arc, tracking, static. A slow continuous move also hides continuity seams; a locked-off frame keeps the background pixel-identical and exposes every seam. Lock the camera only when the subject's motion is simple.
4. **Separate constants from changes.** Not "keep the character consistent" but "Keep the same face, hair and outfit. Change only the pose and camera angle."
5. **Lock identity before style.** Character → product → brand first; cinematic, luxury, neon, experimental after.
6. **Turn emotion into visible behavior.** Not "A woman feels nervous before an important meeting" but "The woman checks her watch twice, taps her fingers against the folder, takes a short breath, and looks toward the closed meeting-room door."
7. **Cut unnecessary physical actions.** Long chains of precise hand–object–face interaction increase failure risk. Start at the moment that carries the message.
8. **State the ending.** Name the final pose, composition, or hold.
9. **Keep shot count realistic** for the duration. Timings are direction, not frame-accurate commands. In a single continuous take a per-beat timing does more harm than good: the marker reads as a boundary, the boundary implies the previous action stopped, and a stop renders as a jump cut.

Use timelines (`0–3s`, `3–7s`, `7–11s`, `11–15s`) when the clip is an edited piece with several visual states and events that must land at a moment: ads, UI animation, music videos, game sequences. Cuts are expected there, so markers cost nothing and buy placement.

| Clip | Write |
| --- | --- |
| Edited piece; cuts expected; copy, UI, or beat sync must land on time | Timelines per beat |
| One continuous take, especially from reference keyframes | Unmarked prose in playback order |
| Either, and the ending must land | One relative duration at the end only |

In a continuous take, let H3 interpolate. Each beat starts from where the previous one ended, joined by connective motion — *that hand continues upward*, *the raised hand then descends* — which leaves only one possible reading. Keep at most one time expression, a hold length for the ending: `for the last two seconds`. A hold duration is a length, not a boundary, so it locks the final frame without slicing the middle.

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

- **Let references carry information.** Do not re-describe what a reference already shows; add only the details that need special protection. The five-model runway test used five reference photos and a deliberately short three-sentence prompt.
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
- For subtitles that need exact wording and timing, add them in an editor afterward. Do the same for on-screen copy when exact lettering stays unreliable.

Dialogue template:

```
In [setting], [named character] says, "[exact line]," in a [voice quality] voice at a [pace] pace.
While speaking, [one simple action]. [Other character] listens silently and [brief reaction].
The camera [one clear direction].
```

Two-speaker scenes, voiceover, and lip-sync troubleshooting are in [Dialogue and voiceover](#dialogue-and-voiceover).

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
| Jump cuts inside a single take | Per-beat time markers | Remove the markers, write unmarked prose; keep only a final hold duration |
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
- In a single take, beats are unmarked prose; only the final hold carries a duration.
- Each shot has one main camera idea.
- Dialogue is short, quoted, and assigned to a named speaker.
- Sound is tied to visible events.
- The ending has a clear composition.
- Conflicting instructions have been removed.
- The hardest action has been tested.

For commercial work, also verify before publishing: packaging, color variant, logo, scale, correct product usage, that spoken claims match verified facts, and that the offer in the CTA is valid.

## The six-part full-reference format

Use this structured format when several assets have different responsibilities in the same generation and the workflow exposes, accepts, or generates the full H3 reference syntax, for example a prompt builder in a local or ComfyUI workflow. Web generators often show simpler names such as `@image1`; follow whatever labels the tool displays. Simple single-image tasks do not need this format.

Typical triggers:

- One image defines a character's face and clothing, another the location or product.
- A video demonstrates movement, camera timing, or editing rhythm.
- An audio file provides a voice, beat, line, or sound texture.
- Some details must stay while others move to a new subject or setting.
- Existing footage must be edited or continued, not just used as inspiration.

### Labels

| Label | Identifies | Typical role |
| --- | --- | --- |
| `<Subject N>` | Reusable visible content taken from one or more references | Character, product, setting, clothing, style, pose, action |
| `<Picture N>` | A specific reference image used as a concrete visual anchor | Opening frame, ending frame, keyframe, storyboard, composition |
| `<Video N>` | A complete video asset or its timeline structure | Source edit, continuation, camera pattern, cuts, motion, pacing |
| `<Audio N>` | A sound signal used by the target video | Voice, dialogue, music, rhythm, ambience, effects |

Numbering rules:

- Each label type is numbered independently. `<Subject 1>` is not automatically "the person in `<Picture 1>`", and `<Audio 1>` need not come from `<Video 1>`. The definition establishes the relationship.
- One image can supply several Subjects; several images can define one Subject.
- A label keeps one meaning through every section. If `<Subject 2>` is a perfume bottle in the definitions, it cannot become the studio later.
- Every label defined at the top must be used in the analysis or the description.

#### Subject or Picture

The image's role decides.

Reusable content for a new scene is a Subject that cites its source image:

```
<Subject 1> is the woman from <Picture 1>, retaining her face, short black hair, and red jacket.
```

An image that anchors an actual frame gets its own Picture definition:

```
<Picture 1> sets the opening composition of [Shot 1], including framing, pose, and lighting.
```

A source image needs a standalone definition only when it has its own frame or planning role.

#### Video and Audio

- A person or action borrowed from footage is still a Subject. Use the Video label for the clip's role as source footage, or for its overall timing, cuts, and camera structure.
- A video does not need an Audio label merely because its file has sound.
- For audio, distinguish reusing the recording from following its voice, rhythm, or texture.

### Sections

| Section | Question it answers |
| --- | --- |
| `subject_definitions` | What does each Subject, Picture, Video, or Audio label mean? |
| `summary` | What kind of target video is being created, and how do the references contribute? |
| `retention_analysis` | Which traits are preserved, changed, transferred, copied, or loosely followed? |
| `detailed_description` | What happens visually and audibly from beginning to end? |
| `overall_soundscape` | Which environmental, physical, and non-verbal sounds fill the scene? |
| `non_diegetic_music` | What background score can the audience hear outside the scene itself? |

The chain: define the assets → explain the task → set preservation rules → direct the timeline.

### Retention markers

Choose the narrowest relationship that matches the goal. If only the camera rhythm matters, do not ask H3 to preserve the entire reference video.

| Marker | Meaning |
| --- | --- |
| `fully_preserved` | Keep the defined identity or role intact |
| `partially_preserved` | Retain selected traits while allowing stated changes |
| `attribute_transfer` | Move an action, look, or other trait to a different subject |
| `weak_reference` | Borrow only a broad quality such as atmosphere or composition |
| `fully_copy` | Use the complete source audio as the target track |
| `partially_copy` | Retain only part of the audio or mix it with new sound |
| `reference` | Generate new audio while following voice, rhythm, wording, or texture |

The last three apply to audio. To follow a voice without copying the recording, use `reference` and describe the timbre, pace, and delivery.

### Template

```
### subject_definitions:
[Define each Subject, Picture, Video, and Audio label, its source, and its role.]

### summary:
[task type + additional task if needed] Create [target video], using [labels] for [their roles].

### retention_analysis:
[label] ([shots or role]): [relationship marker] - [what stays, changes, transfers, or is copied].
[Repeat for each separately defined item.]

### detailed_description:
[One or two sentences describing the visual style.]
[Shot 1] [Opening composition, subjects, action, camera, dialogue, and synchronized sound. Name references where they take effect.]
[Shot 2] At [cut time], the camera cuts to [next view and action].
[Use additional shots only when needed.]

### overall_soundscape:
[Ambient, physical, and non-verbal sounds.]

### non_diegetic_music:
[Instruments, tempo, and dynamics; N/A when no background score is wanted.]
```

Syntax conventions seen in the example below:

- Shots are marked `[Shot 1]`, `[Shot 2]`; cut times are written `At 00:05.000`.
- Speakers get stable IDs `(S1)`, `(S2)` that never change across shots.
- Spoken lines are wrapped as `<d>[Language] line text</d>`.
- Environmental sound goes in `overall_soundscape`; `non_diegetic_music` is only for score outside the characters' world.

### Building one

1. **Make a reference map** before writing prose. One primary responsibility per source:
   - Character image → identity and clothing
   - Studio image → environment and lighting
   - Motion video → performance movement and camera timing
   - Voice sample → timbre and delivery for new dialogue

   The map exposes competing references and unnecessary assets.
2. **State what remains and what changes** with one retention entry per defined item, including where it appears.
3. **Write events in playback order**: opening composition, then actions, reactions, camera movement, cuts, dialogue, and synchronized sound.

### Worked example

Character, motion, and voice. This illustrates the structure; it is not a tested generation.

```
### subject_definitions:
<Subject 1> is the performer from <Picture 1>: the same face, copper hair, metallic blue outfit, and silver ear cuff.
<Subject 2> is the studio from <Picture 2>, with concrete walls and a circular light.
<Subject 3> is the half-turn and hand gesture from <Video 1>, transferred to <Subject 1>.
<Video 1> guides the slow clockwise camera orbit and timing.
<Audio 1> guides <Subject 1>'s low, measured voice (S1) for new speech.

### summary:
[reference generation + audio reference] Create an eight-second fashion film with <Subject 1> in <Subject 2>, applying <Subject 3>, following <Video 1>'s camera timing, and referencing <Audio 1> for speech.

### retention_analysis:
<Subject 1> ([Shot 1], [Shot 2]): fully_preserved - retain identity, outfit, and accessories.
<Subject 2> ([Shot 1], [Shot 2]): partially_preserved - keep materials and circular light; adapt the layout.
<Subject 3> ([Shot 1]): attribute_transfer - apply the turn and gesture to the performer.
<Video 1> (camera timing): partially_preserved - follow the orbit timing; add a final close-up cut.
<Audio 1> (S1): reference - follow vocal weight and pace without copying the recording.

### detailed_description:
Minimal live-action fashion film with cool highlights.
[Shot 1] <Subject 1> stands in <Subject 2>, the circular light behind her. She performs <Subject 3> as the camera follows <Video 1>'s slow clockwise orbit. Using <Audio 1>'s low, measured delivery, she (S1) says: <d>[English] Design should move before it speaks.</d>
[Shot 2] At 00:05.000, the camera cuts to a closer three-quarter view. Her hand settles beside her collar, the light brightens slightly, and she holds the pose until the clip ends.

### overall_soundscape:
Soft fabric movement, quiet footsteps, and a low electrical hum.

### non_diegetic_music:
Slow electronic pulses with a sustained low synth tone, ending after the final pose.
```

Why it is shaped this way: the performer and studio are Subjects because their content is reused in a new shot; movement (`<Subject 3>`) is tracked separately from camera timing (`<Video 1>`); the voice sample guides newly generated speech rather than supplying copied audio.

### Common mistakes

| Mistake | Correction |
| --- | --- |
| Making every reference image a frame anchor | Use a Subject for reusable content; give a Picture its own entry only when it anchors a frame, composition, or storyboard |
| Labelling a person from a video as the Video | Define the person as a Subject; use the Video label for footage, camera timing, or edit structure |
| A label changes meaning between sections | Keep the reference map beside you; when a reference changes, update every section |
| `fully_copy` used when only the voice quality is wanted | Use `reference` and describe timbre, pace, delivery |
| A Subject defined with no retention rule | Add an entry stating where it appears, what stays, what may change |
| A plot summary in place of a shot description | Describe visible actions, camera, sound, and the ending; replace "a dramatic reveal" with what is actually seen and heard |
| Time markers inside one continuous take | Drop the markers in `detailed_description`; keep only a final hold. The format accepts timings; it does not require them |

When asking an LLM to draft this format, supply the reference map, duration, required dialogue, and fixed traits, then check label consistency and conflicting instructions yourself.

## Workflows by use case

Choose the workflow first, write the prompt second.

| Goal | Start with |
| --- | --- |
| Product commercial | Product references + controlled shot sequence |
| Minimalist product ad | Hero, detail, and closing references + timed storyboard |
| UGC-style social ad | Product image + creator persona + lifestyle scene |
| Ad variants for testing | One spec, one changed variable per version |
| Product or app demo | First-frame UI reference + micro-actions |
| Localized ad | Local hook and persona before any translation |
| Fashion video | Character references + identity protection |
| Game promo | Game references + gameplay logic |
| UI animation, app prototype | Reference screens + timed state transitions + layout protection |
| Music video | Singer references + song section as audio + one scene per musical moment |
| Stylized or mixed-media video | Stable subject + explicit style transitions |
| Motion recreation | Source video + replacement reference |
| Existing video edit | Narrow edit instruction + preserve everything else |
| Anything over 15 s | Several connected clips planned as an edit |

### Contents

- [Commercial planning](#commercial-planning)
- [Minimalist product ads](#minimalist-product-ads)
- [Premium and fast-cut commercials](#premium-and-fast-cut-commercials)
- [UGC-style ads](#ugc-style-ads)
- [Creative variants](#creative-variants)
- [Product demos with UI and hands](#product-demos-with-ui-and-hands)
- [Localized ads](#localized-ads)
- [UI, web, and game interfaces](#ui-web-and-game-interfaces)
- [Music videos](#music-videos)
- [Stylized and mixed-media video](#stylized-and-mixed-media-video)
- [Dialogue and voiceover](#dialogue-and-voiceover)
- [Motion transfer and video-to-video](#motion-transfer-and-video-to-video)
- [Targeted video edits](#targeted-video-edits)
- [First and last frame](#first-and-last-frame)
- [Character consistency](#character-consistency)
- [Multi-clip and long-form](#multi-clip-and-long-form)

### Commercial planning

Define eight things before writing a prompt:

| Element | Question |
| --- | --- |
| Product | What are you selling? |
| Audience | Who should care? |
| Platform | Where will the video run? |
| Hook | What happens first? |
| References | What must remain consistent? |
| Action | What must visibly happen? |
| Message | What is the main benefit? |
| CTA | What should viewers do next? |

Then shape the shots as `Hook → Product → Demonstration → Benefit → CTA`.

Prompt order for product work: `Product identity → Selling points → Human interaction → Camera → Brand aesthetics`. Say what must sell before saying how the ad should feel; do not open with a pile of style adjectives.

Product accuracy is part of quality. Before approving:

| Check | Question |
| --- | --- |
| Appearance | Does the packaging still match? |
| Color | Is the variant correct? |
| Logo | Is it readable and accurate? |
| Scale | Does the product look physically plausible? |
| Interaction | Is the person using it correctly? |
| Claim | Does the spoken benefit match verified information? |
| CTA | Is the offer actually valid? |

Verify how the product is really operated before storyboarding. Two real ad projects needed a correction pass because the first version showed wrong usage: an essential oil applied directly instead of added to a diffuser, and a coffee capsule inserted wrongly. The fix in both cases was to spell out the real steps, for example `Lift the silver handle → Insert the capsule into the upper slot → Close the handle → Place the cup under the outlet`.

### Minimalist product ads

A nine-step path from brief to export:

1. **Check product facts.** Gather a sharp main photo plus detail views for any action you will show. Record actual color, finish, proportions, and control positions. One front photo cannot explain a hidden hinge or port. Replace blurred or obstructed images.
2. **Write a short brief**: lead variant, message, duration, aspect ratio, visual style, copy. Example: "Create a 10-second, 16:9 ad for the matte-blue lamp. Show its sculptural shape and warm light in a clean studio setting. Use one product only, no presenter, and a short English closing line."
3. **Choose one story.**

   | Story | Viewer sees | Suits |
   | --- | --- | --- |
   | Product reveal | Overall design, then a closer look | Launches, distinctive shapes |
   | Feature in action | A visible change with a clear result | Lighting, opening, folding, docking |
   | Color collection | Lead product, then supporting variants | A coordinated range |

4. **Direct motion.** State whether the camera moves around a stationary product or the product itself rotates. Connect shots through a shared edge, shape, or movement direction. Alternate movement with stillness, and keep the ending steady.
5. **Write on-screen copy.** Three to five words, one line at a time, exact wording and timing stated, placed in open space, subtle fade or slide, held long enough to read. Avoid claims the product information cannot support.
6. **Prepare three standalone references**: hero (whole product, flattering angle, readable at thumbnail size), detail (material or function that matters to this ad, nothing invented), closing (final composition with room for copy, same background and light direction). They are visual targets, not three frozen consecutive shots.
7. **Build a timed storyboard** as a table of time, product and camera, copy, and rhythm. It exposes ordering problems a paragraph hides.
8. **Generate**, connecting each reference to its role, then refine sound: match the product's personality, align an accent with the reveal or feature, keep the final seconds calm, and make sure audio resolves cleanly through the hold.
9. **Check before export**: product, action plausibility, message, format, audio, final frame. Save the prompt, references, and settings with the approved export.

Template:

```
Create a [duration]-second [aspect ratio] minimalist ad for [product]. Use [hero reference] for appearance, [detail reference] for the relevant close-up, and [closing reference] for the ending. Preserve [specific product features]. Follow this sequence: [timed actions and camera directions]. Display exactly "[copy]" during [time window], using [placement and restrained text motion]. Add [sound direction]. Finish with [closing hold]. Show one full-frame composition at a time, without reference-board layouts or extra objects.
```

One product photo is enough for a simple camera move around a visible front or three-quarter view. Plan vertical and horizontal versions separately when the product and copy need different positions.

### Premium and fast-cut commercials

- For fast cutting, define two visual anchors, character identity and product identity, and let camera distance, silhouette, lighting, and framing change aggressively around them.
- Never let one cut introduce a new character, product angle, location, and style together.
- Name the specific parts of the product worth showing (for headphones: shape, material, earcups, hinges, fit), since priorities differ by product.
- Leave clean composition space where text or branding will be added later.
- Do not let cinematic effects hide the product or the campaign message.

### UGC-style ads

Make it feel like content first and an ad second.

```
Product image → Creator persona → Lifestyle scene → Product use → Natural recommendation → Offer / CTA
```

- Keep the creator consistent across shots with dedicated creator references.
- Split the sales message: voiceover carries experience and benefit, on-screen text carries offer and urgency. In one essential-oil ad the spoken ending became "A familiar scent makes anywhere feel like home." while the screen showed `BLACK FRIDAY · 15% OFF · SHOP NOW`.
- Match props to the intended aesthetic; a mismatched diffuser was replaced with a ceramic one via an extra reference.
- Start close to the selling moment. If the message is the finish, skip opening, pumping, and first application.

Approaches by category:

| Category | Creative approach |
| --- | --- |
| Foundation | On-camera try-on + texture + key benefits |
| Yoga leggings | Fit demo + squat test + lifestyle styling |
| E-bike | Real commute scene + product consistency |
| Eyewear | Handheld social style + natural storytelling |

### Creative variants

Generate hypotheses, not duplicates. Decide what each version tests.

| Variable | Version A | Version B | Version C |
| --- | --- | --- | --- |
| Hook | Pain point | Surprise | Lifestyle |
| Creator | Fashion-focused | Everyday user | Expert-style |
| Product angle | Benefit | Demonstration | Value |
| CTA | Shop now | See how it works | Limited offer |

Change one big idea at a time: same product and offer with a different hook, or the same hook with a different persona. Each combination of creator reference, product reference, and storyboard is its own generation; format stays constant.

### Product demos with UI and hands

Every interaction needs a visible reaction. Break the demo into micro-actions:

```
Tap → Change → Pause → Tap → Confirm
```

- Prepare a first-frame UI reference and a hand-position reference; define logo and CTA elements in advance.
- Supply product variants (for example black and white earbuds) as separate references when a color change is the feature.
- Generate each short action as its own section and combine them.
- Expect to refine finger placement, transition effects, button bounce feedback, and cart animation after the first pass; hand–object overlap and weak feedback are the usual first-version faults.
- Clear interaction feedback matters more than extra camera movement or effects.

### Localized ads

Localization changes the context, not just the words: `Language + Persona + Humor + Scenario + Product truth`.

Ask first what situation will feel familiar to the audience, then decide `Hook → Persona → Humor → Language`. Do not translate an English script word for word. One Thai coffee ad was rebuilt around an office "Monday personality switch" (`Low energy → Work errors → Coffee discovered → Coffee prepared → Energy restored`) with game-style overlays (ERROR, ITEM FOUND, LOADING WORK MODE, LEVEL UP), Thai voiceover, and office ambience.

### UI, web, and game interfaces

Good UI video needs logic, not just motion. The winning combination is reference screens + state changes + interaction timeline + layout protection.

Describe states, never just "animate the UI":

```
State A → User action → Interface response → State B
```

For websites:

```
Scroll → Section change → Content response → Final state
```

- Name what must stay stable: character identity, font and layout, product or item appearance, main color system, navigation position.
- Useful phrases: preserve navigation position, maintain typography, keep the product centered, transition to the next section, synchronize background and UI changes.
- Map each reference screen to a time window (`0–3s: Show Image 1 home screen…`).
- Give the motion a hierarchy. Do not fire every button, panel, particle, camera move, and character action at once.
- "Smooth" is an outcome, not an instruction; the prompt still needs interaction logic.
- For app prototypes, state the viewing setup: straight-on, full-screen, no phone frame, mouse, or fingers.
- Close with the failure modes to avoid: text deformation, element drift, layout changes.

For gameplay, describe the camera as part of the game system: third-person follow camera, over-the-shoulder view, player-controlled perspective, loading transition, mission progression, UI response. That carries more structure than "GTA-style cinematic". Gameplay footage and a cinematic trailer are different requests; if you want gameplay logic, define how the camera follows the character and how the interface reacts.

### Music videos

Treat the song as a timeline, not one long prompt.

```
Song → Shot Plan → H3 Clips → Select Takes → Connect Scenes → Final Edit
```

1. Create or prepare the track.
2. Map sections to visual jobs:

   | Section | Visual purpose | Example |
   | --- | --- | --- |
   | Intro | Establish the world | Slow location reveal |
   | Verse | Build story or personality | Close-ups, narrative |
   | Pre-chorus | Increase tension | Stronger motion |
   | Chorus | Deliver the hero moment | Performance, dance, effects |
   | Bridge | Create contrast | New location or style |
   | Outro | Finish the idea | Final performance or callback |

3. For each scene, upload the matching song section as the audio reference (up to 15 s) with a singer image, an optional dance or camera video, and a prompt directing that one shot.
4. Review identity, motion, composition, and fit to the music before moving on.

Shot formula:

```
Subject + Performance + Location + Camera + Music energy + Visual style
```

For effect-heavy videos, layer the instruction so effects never replace the performer:

```
Performer → Camera → Interaction → Graphic language → Ending
```

- Audio provides musical context; the prompt directs the shot. "Create an amazing cinematic music video for this song" directs nothing.
- Change the world, not the performer. Build a singer reference set (clear face portrait, full body, main hairstyle, signature outfit, hero look) and hold `Face → Hair → Wardrobe → Color palette → Lighting → Visual style` steady.
- Pick one hero visual idea per moment. Do not max out camera speed, typography, UI, particles, animation, and performer movement together.
- High-speed scenes need stronger identity control, not less.
- For social cuts: put the payoff first, use the chorus or drop, keep the action readable at a glance, and design the final pose to reconnect to the opening for loops.
- For experimental work: name one dominant style, say how the world reacts to the music, and what stays recognizable. "Surreal" alone is too broad.
- Use first and last frames to plan transitions between clips. That mode cannot take an audio reference in the same request (see [Limits](#limits)), so such a clip will not have the song section attached. If a scene fails, regenerate that scene.

### Stylized and mixed-media video

Define both what changes and what survives the change.

```
Same subject + same action direction + changing visual layer
```

- Style can change; identity should not change by accident. Do not let an animated subject silently become a live-action person after a cut.
- "Mixed-media style" does not explain a transition. Describe the mechanism: an occlusion (clouds or an object covering the lens), an action match, a whip pan.
- Camera imperfections are a style tool: phone-camera shake, exposure fluctuation, delayed autofocus, DV noise, scan lines.
- Describe typography as part of the motion and tie kinetic text to specific actions.
- Define pacing before individual shots when the piece is a teaser or montage.

### Dialogue and voiceover

Order of a dialogue prompt:

```
Scene → Speaker → Exact line → Delivery → Visible action → Listener reaction
```

**Single speaker.** One short line and one purposeful gesture. Choose one specific delivery (calm and conversational) rather than stacking excited, whispered, dramatic, and fast. Leave a beat after the sentence for the expression to settle. Verify the line and the face before adding camera movement.

> A medium close-up shows Maya in a green jacket beside a café window. She looks toward the camera and says, "Hi, I'm Maya. Let me show you my favorite spot," in a warm, relaxed voice. She makes one small gesture toward the window, then smiles after finishing. The camera remains still. Quiet café ambience, no background music.

**Two speakers.** Give each a name plus a visible feature and repeat it with every line; avoid "he", "she", "the other person". Keep the voices distinct but simple (a soft delivery against a lower, measured one). Describe the listener explicitly, including a closed mouth. Test with a fixed camera first and add reaction shots only once speaking order works.

> A steady medium two-shot shows Maya in a green jacket and Leo in a navy sweater at a café table. Maya asks in a light, curious voice, "Did you find the place?" Leo listens with his mouth closed. After Maya finishes, Leo replies in a lower, relaxed voice, "Yes. It's just around the corner." Maya listens silently, then smiles. Soft café ambience, no music.

If lines still mix, generate separate shots per speaker and assemble them. No speaker limit is documented, but add speakers gradually or split group conversations into shots.

**Voiceover.** Make the sound source explicit: an off-screen narrator speaks while the visible character performs a specific silent action with lips closed. Do not describe the visible character as "explaining" or "introducing".

> A woman silently places a ceramic travel mug on a desk and turns it so the handle faces the camera. An off-screen narrator says, "A little comfort for your everyday routine," in a calm, clear voice. The woman's lips remain closed throughout. The camera slowly moves closer to the mug. A soft ceramic tap and quiet room ambience, no music.

If mouths still move, generate silent visuals and add narration in the edit. That works for voiceover only; a track added afterward will not sync a speaking face. Add music after the narration works, instrumental and quieter than speech.

**Reviewing.** Check three things separately: who speaks, whether the words are correct, and whether the mouth follows the speech. Fix the clearest failure first. Clearer prompts improve control but do not guarantee lip sync, and matching descriptions do not guarantee identical voices across independent generations.

### Motion transfer and video-to-video

A video reference carries several layers at once: motion, timing, camera, perspective, and interaction. State which ones you want.

```
Preserve motion + Replace subject + Keep timing
```

- The source already contains the direction. Do not rewrite its choreography unless you are changing it.
- To take motion without style, say the video controls motion or camera only and define appearance with an image or the prompt.
- To keep the original background, say the video is for motion only and the environment, composition, or background must remain unchanged.
- Expect interpretation rather than exact reproduction, especially with complex interactions or large transformations.

Hand-driven panel effect, a five-step recipe:

1. Record a clean five-second phone clip, static camera: hands closed → pull apart → rotate → hold.
2. Generate each color or style variant separately; one generation, one visual task.
3. Assign one job each: `@Image1` → person, clothing, background; `@Video1` → hand motion and timing only; `@Image2` → content inside the panel only.
4. Attach the panel to the hands as a physical sheet: index fingers at the top corners, thumbs at the bottom, following a timeline of `0–1s closed`, `1–3s expand`, `3–4s rotate`, `4–5s hold`, with no floating or lag.
5. Change only the panel. Outside it: realistic, head still, neutral expression, locked camera, unchanged lighting. Output 5 s, 24 fps, 2K, `@Image1` aspect ratio.

Prompt order: `Reference roles → Identity → Motion → Panel behavior → Panel style → Camera`.

### Targeted video edits

```
Change X → Replace Y → Preserve everything else
```

Keep the instruction narrow: "Change the cat's eyes to blue. Replace the ocean in the background with a grassland." Do not bundle a local edit with changes to camera, action, lighting, pose, or timing; once everything changes it is no longer an edit.

### First and last frame

Suited to product transformations, before-and-after scenes, environment changes, fashion transitions, poster animation, visual reveals, and controlled shot endings.

Not "Turn Image 1 into Image 2" but:

```
Starting state → visible physical change → evolving structure → final state
```

- Use one continuous camera path between the frames.
- Name the details that must match at the end: framing, pose, product placement, light direction.
- Cannot be combined with reference images, videos, or audio in the same request.

### Character consistency

| Reference | Controls |
| --- | --- |
| Front portrait | Face, hair, makeup |
| Side view | Facial profile |
| Full-body image | Proportions and clothing |
| Detail image | Jewelry, accessories, props |

- Keep fixed: face, hair, outfit, product, logo, important props. Allow to change: pose, expression, action, camera angle, framing.
- Lock identity before adding motion.
- Reuse the same clean pack across a campaign; individual generations can still vary, so review each.
- Avoid heavily obstructed identity references.

### Multi-clip and long-form

A longer video is a sequence, not one oversized prompt.

- Each clip has one purpose, a defined start, a defined end, only the references it needs, and continuity with its neighbors.
- Split by story blocks. One 30-second anime promo used two 15-second generations: world, entrance, and first clash; then escalation, energy burst, and final pose.
- Build anchors first: prepare style references and keyframes for the major moments (confrontation, entrance, clash, close-up, explosion, final pose), then generate the sections that connect them.
- Give a running visual thread to long experimental pieces. One one-minute film used a sideways-running character linking street footage, silhouette masks, and graphic space, with three anchor images for opening, silhouette, and closing text.
- Rewrite risky or over-specific wording into plain visual language: original descriptions instead of IP-like names, and "fast horizontal tracking, beat-cut flashes, motion through graphic space" instead of "copy the camera movement".
- After generation, the work shifts to transitions, pacing, identity, and continuity. Regenerate only the weak section.

## Example prompts

Prompts quoted from the minimax-h3.com guides, plus one result from our own testing, grouped by mode. Adapt the subject, scene, references, and direction; keep the structure.

**Tested** means the guide it comes from, or our own testing, showed or described a generated result. **Untested** means it was offered there as a starting structure or illustration.

### Contents

- [Text-to-video](#text-to-video)
- [Image-to-video and first/last frame](#image-to-video-and-firstlast-frame)
- [Reference-to-video](#reference-to-video)
- [Product and commercial](#product-and-commercial)
- [UI, web, and game](#ui-web-and-game)
- [Music video and stylized](#music-video-and-stylized)
- [Motion transfer and editing](#motion-transfer-and-editing)

### Text-to-video

**Product shot** (untested). One subject, one camera arc, stability constraints, stated ending.

```
Premium cinematic product video in a dark studio. A matte-black perfume bottle stands on wet stone as a narrow warm light moves across the glass. The camera makes a controlled half-arc from left to right. Fine mist drifts behind the bottle. Keep the bottle shape and label stable. No extra text or objects. End on a centered close-up.
```

**Laundromat mixed media** (tested). Location and mood first, specific props, camera imperfections as style.

```
15 seconds, 16:9 landscape. Combine a live-action late-night laundromat with hand-drawn luminous animation. The small self-service laundromat has gently flickering fluorescent lights, running washers, plastic baskets, a worn bench, and one sock on the floor. Keep the space quiet and faintly nostalgic. Use a one-handed phone-camera feel with visible shake, exposure fluctuation under white fluorescent light, environmental reflections in glass, and delayed autofocus at close range. Avoid polished commercial composition; it should feel like an authentic late-night encounter, filmed while following a strange apparition.
```

**Y2K rap music video** (tested). Layered as performer → camera → interaction → graphic language → ending.

```
15-second Y2K dopamine-style rap music video. A young female singer in a bright pink cropped jacket, silver low-rise cargo pants, and colorful narrow sunglasses performs confidently inside a futuristic retro computer room.

The camera rapidly pushes, whips, and rotates to the beat, switching between wide full-body shots, fisheye close-ups, and low angles.

Windows 98-style pop-up windows repeatedly appear. The singer pushes windows aside, moves through the interface, and physically interacts with the pop-up effects.

Use fluorescent pink, electric blue, and lemon yellow with pixel hearts, CDs, holographic stickers, and oversized chrome typography. Add DV noise and scan lines.

End with the interface crashing into a full-screen blue-screen composition. The singer emerges through it as large chrome lettering hits toward the camera.
```

**Live-action parkour** (tested). One anchored subject while angles, environments, and graphics move fast.

```
15 seconds, 16:9. High-energy live-action subway parkour opening. Show only one original young male runner with realistic facial features, skin, and clothing.

He sprints between three subway tracks while the camera rapidly tracks backward. He changes lanes to avoid trains, vaults barriers, slides beneath obstacles, and finally jumps onto the roof of a moving train.

Switch quickly between frontal, side, and overhead camera angles. Blend live action with high-saturation comic-film aesthetics using heavy black outlines, halftone dots, CMYK misregistration, RGB offsets, frame echoes, and speed lines.

Display "RUN!", "DODGE!", and "JUMP!" as kinetic typography synchronized with the actions.

End with the runner frozen in midair as "KEEP RUNNING!" crashes into frame, followed by a white flash and cut to black.
```

**Supercar website** (tested). Scroll-driven timeline with headline text and a final hero state.

```
Create a premium supercar website UI showcase under 15 seconds, using bold flat illustration, high-contrast colors, full-screen scroll storytelling, and parallax animation.

0–3s: Begin on a solid-color background. A futuristic supercar slides rapidly into the center from the right. Combine premium 3D rendering with a flat-illustration feel. Push the camera toward the headlights, wheels, air intakes, and carbon-fiber details. Display the large headline "BORN TO OUTRUN" on the left and a minimal vertical scroll navigation on the right.

3–7s: Scroll downward. Keep the car centered while the background shifts from bright orange to dark blue, fluorescent green, and black. With each page section, change the paint, wheels, and rear wing. Introduce performance text with offset slides, enlarged numbers, and extending lines: "0–100 KM/H 2.7S," "V8 TWIN TURBO," and "TOP SPEED 350 KM/H."

7–11s: Add strong parallax while scrolling. City roads, neon light trails, and track markings move at different speeds. Wheels continue rotating and the car slightly tilts and floats. When the cursor passes over the vehicle, highlight individual areas and expand transparent specification labels.

11–15s: Quickly return to a final hero screen with a black background. The supercar stops facing forward and its headlights turn on. A moving light strip appears on the floor. The brand logo and "CHOOSE YOUR MACHINE" rise from below, followed by a minimal "EXPLORE THE DRIVE" button. End with a subtle pull-back.

Premium automotive advertising aesthetic, smooth page scrolling, strong visual rhythm, clean typography, rounded buttons, realistic reflections, cinematic motion blur, 16:9, 24fps, no real automotive brand logos.
```

### Image-to-video and first/last frame

**Portrait** (untested).

```
Begin exactly from @image1. The woman takes a slow breath, lifts her eyes toward the window, and turns her head slightly as soft daylight moves across her face. Use a gentle push-in. Preserve her identity, hairstyle, clothing, and the room layout. Add quiet room tone and distant rain.
```

**First to last frame** (tested). Motion between the frames, one continuous camera path, details that must match at the end.

```
Begin exactly from Image 1 and preserve the woman's identity, green jacket, cream shirt, matte-black cup, rooftop garden, and sunrise direction. She takes three measured steps while the camera follows one slow half-orbit. She raises the cup, looks toward the camera, and gives a restrained smile. Converge precisely on Image 2, matching its framing, pose, product placement, and warm horizon.
```

**Space-opera teaser from a first frame** (tested). Pacing before shots, concrete transition language, typography as motion.

```
Epic theatrical space-opera teaser. Keep the pace fast and the scale enormous. Use sharp hard cuts, a shaking command deck, white-hot flashes, split-second black frames, and a violent jump-to-warp impact. Title cards should use wide-tracked cinematic typography with restrained material texture, subtle illumination, and a faint edge glow.
```

### Reference-to-video

**Multimodal** (untested). Image for identity, image for location, video for pace and camera, audio for vocal tone.

```
Use @image1 for the woman's identity and green jacket. Use @image2 for the rooftop garden and sunrise lighting. Use @video1 for her walking pace and the slow tracking camera. Use @audio1 for the calm vocal tone. She walks three steps, raises the cup, looks at the camera, and says, "Take the morning with you."
```

**Three-shot storyboard** (untested).

```
Use @image1 for the main character and @image2 for the nighttime station. Shot 1: Wide tracking shot as she walks along the wet platform. Shot 2: Close-up of the ticket as her fingers tighten. Shot 3: She looks up and steps toward the arriving train. End as warm carriage light reaches her face.
```

**Sequential keyframes** (tested). Every image has a sequence position; fixed elements separated from moving content.

```
Use Images 1–4 as sequential keyframes, seen through a vintage binocular viewfinder searching for the MINIMAX installation. Open out of focus with subtle handheld shake, then push in quickly and rack focus onto Image 1. Between keyframes, use fast binocular-scan transitions with whip movement, motion blur, optical smearing, and brief exposure flicker. Keep the twin circular lens mask fixed throughout. Preserve the core composition and MINIMAX installation exactly.
```

**Character sheet plus storyboard in one image** (tested). States what each region of the sheet controls.

```
Use the upper character sheet to define Aric Vale's face, dark tousled hair, stubble, athletic build, clothing, and gear. Maintain his identity and outfit throughout. Use the lower storyboard as visual guidance for the adventure sequence, from spotting the ruins and planning the route through climbing, exploring, claiming the artifact, and escaping. Keep the character, environment, and cinematic style consistent.
```

**Continuous take from four keyframes** (tested). Four reference photos of one squatting pose in one room, fifteen seconds, no time markers in `detailed_description`, one slow arc. Per-beat markers produced jump cuts at every boundary; unmarked prose ran continuous.

**Multi-model runway** (tested). Deliberately short because five reference images carry identity.

```
Create a branded fashion presentation. Have every person from the reference images walk together on the same runway as part of a fashion show. Preserve each person's appearance, realism, and identity.
```

**Hand-driven panel effect** (untested as written). It is the example prompt for the [five-step recipe](#motion-transfer-and-video-to-video), which came out of a real multi-reference test. Scope of each reference restricted explicitly.

```
@Image1 defines the subject, clothing, and background. @Video1 provides hand motion and timing only. @Image2 defines the content inside the rectangular panel. Attach the four panel corners to the thumbs and index fingers so it expands and rotates with the hands. Keep everything outside the panel realistic and unchanged. Use a locked camera and consistent lighting.
```

Append only the style variation needed, for example `dark navy, electric blue rim light, cyan circuit details.`

**Travel vlog with hand-drawn animation** (tested). Occlusion transitions between locations with one continuous subject.

```
15 seconds, 16:9 travel montage. Blend live-action travel vlog footage with glowing hand-drawn animation. A young woman @Image 1 carries a travel backpack and camera while rapidly moving through multiple destinations. Keep her movement continuous and switch scenes tightly to a strong musical beat.

Open with the woman walking quickly past an airport window. A hand-drawn airplane rises into the sky and disappears into clouds. The camera pushes toward the clouds until they completely cover the frame.

On the beat, the clouds open into a tropical beach with palm trees. She looks upward. Follow her gaze as a hand-drawn coconut falls toward the camera and covers the lens.

Reveal a snowy mountain. The woman is now wearing ski clothing and descends the slope alongside a hand-drawn female character at realistic human scale. After skiing, the two embrace and spin together.

Use tracking shots, whip pans, occlusion transitions, and action-match cuts. Keep the pacing energetic with subtle handheld movement, natural lighting, and an authentic travel-documentary feel rather than a commercial look.
```

### Product and commercial

**Minimalist lamp ad** (untested). Three references with separate roles, timed storyboard, exact copy, sound that resolves, explicit exclusions.

```
Create a 10-second, 16:9 minimalist ad for the matte-blue table lamp. Use [hero image] for its shape, color, and proportions; [detail image] for the shade and finish; and [closing image] for the final layout. Preserve the shade, stem, and base without redesigning them.

0–2s: Show the full lamp immediately. Keep it stationary while the camera makes a gentle quarter-orbit.

2–4s: Cut to the shade detail and slow the camera to a stop.

4–6s: Warm light turns on beneath the shade, softly illuminating the surface.

6–8s: Return to the closing composition. In the open space beside the lamp, fade in "A Little More" in dark gray, then "Warmth" in blue on the same line.

8–10s: Hold the illuminated lamp and the complete text "A Little More Warmth" steadily.

Use a simple off-white background and soft shadows. Add a restrained instrumental pulse with a gentle accent as the light turns on, no vocals. Keep sound present through the final hold and resolve cleanly. No additional text, invented logos, grids, or split screens.
```

**Premium headphone TVC** (tested). Product identity and selling points before models and brand aesthetics.

```
Create a premium fashion headphone commercial with the pacing, editing rhythm, white-studio aesthetic, and cool luxury atmosphere of an international fashion campaign.

Use a seamless pure-white studio. Center the visual direction on a futuristic premium headphone product, emphasizing industrial design, smooth contours, refined materials, metal details, matte or reflective finishes, structural layers, and a luxury-tech identity.

Open with detailed product shots using floating presentation, slow rotation, and macro push-ins to reveal the earcups, headband curve, controls, metal hinges, charging port, craftsmanship, and reflections.

Then introduce two full-body models—a Black female model and a Western female model—while preserving their fashion styling, pose quality, studio lighting, and editorial attitude.

Show them wearing the headphones through fashion poses, turns, side-profile close-ups, walking freezes, and dual-model compositions. Emphasize fit, futuristic styling, accessory value, and premium consumer-electronics quality.

Keep the overall visual language minimal and high-end: generous negative space, clean composition, cool whites, controlled metallic highlights, transparent reflections, and luxury-tech aesthetics.
```

**Luxury perfume commercial** (tested). Fast cuts held together by two anchors, the model and the bottle.

```
15 seconds, 16:9. Create a mysterious luxury live-action perfume commercial. A cool, elegant female model @Image 1 stands on a deep-blue stage while strong backlighting and spotlights define her silhouette.

Cut rapidly to electronic music: low-angle silhouette, side-profile turn, hair flip, body detail, and lip close-up. The model puts on black sunglasses and looks directly into the camera.

Intercut the perfume @Image 2 with bottle rotation, illuminated contours, and a spray moment. Add flashes, smoke, and back-view shots while keeping both the model's identity and perfume appearance consistent.

End with the model walking into the stage under a spotlight, followed by a black-background hero shot of the perfume.

Overall cinematic aesthetic, smooth camera movement, and clean beat-synced editing.
```

**TikTok beauty UGC** (tested). Timed lines of dialogue, hard physical steps removed on purpose. Known limitation: the transition from partly blended to finished makeup was not fully continuous in the generated result.

```
9:16, 15 seconds. Authentic North American TikTok beauty-commerce video. A female creator sits at an apartment vanity in soft afternoon side light with natural skin texture.

0–4s: She holds LUMERA Skin Veil Foundation beside her face: "Wait until you see this finish."

4–7s: Cut to a macro product shot. Keep the branding and liquid appearance stable: "Lightweight and made to look like skin."

7–12s: Close-up of the face. Foundation is already dotted on the cheek and she blends it with two fingers: "No streaks, no cakiness."

12–15s: Show the finished complexion from a side angle: "Smooth and completely natural."

Preserve product consistency throughout. Skip opening the bottle, dispensing liquid, and initial application steps. Avoid distorted hands, beauty tools, plastic-looking skin, or changing text.
```

**Brand music-campaign shot** (untested).

```
Metallic headphones rotate beside a performing artist as bass pulses trigger flowing light trails, clean premium studio environment, controlled dolly movement, polished black-and-purple campaign aesthetic.
```

### UI, web, and game

**Game character UI** (tested). Global constants first, then one reference screen per time window.

```
Strictly follow the reference images for the character and art direction. Keep the same character, backpack, outfit, and game-world identity throughout. Use a high-saturation street-graffiti 3D game style dominated by cyan, bright yellow, orange, and black. UI elements should use ink splashes, heavy outlines, stickers, and neon edging. Keep all UI text clear and stable and avoid real game logos or existing copyrighted characters.

0–3s — Character Selection Interface @Image 1
A high-angle camera slowly pushes forward. A short teal-haired character stands on a circular display platform, slightly turned, holding one backpack strap and looking confidently toward the camera. Character portraits slide in from the left, with the active character highlighted by a yellow border and splash effect. A character information panel opens on the right with name, role, ability icons, and short stat bars. The camera gently orbits right to reveal the outfit, shoes, and backpack.

3–6.5s — Backpack and Decoration Selection @Image 2
The camera moves toward the character's front-side angle. The character removes the backpack and opens it in front of the body. Badges, charms, stickers, and accessories appear inside with cyan, purple, and orange outlines. The right UI switches to a decoration-selection panel. The selected cyan skull badge receives a yellow selection border. The character taps and changes an accessory, triggering a short glow, bounce, and ink-splash response.

6.5–10s — Drink and Attribute Display @Image 3
The character pulls a glowing blue drink from the backpack and holds it toward the camera. Focus shifts to the bottle while the character and background become slightly blurred. A blue information panel appears on the right with the drink name, rarity, duration, bubble boost, and foam-shield attributes. Small bubbles rise inside the bottle. End with a burst of blue bubble energy and the "Use" button highlighted.
```

**Travel app prototype** (tested). Four static screens mapped to four windows, with layout protection.

```
9:16, 15 seconds. Travel app UI interaction animation. Straight-on view, full-screen interface, no phone frame, mouse, or fingers. Strictly preserve the typography, colors, English text, and layout from the reference images.

0–3s: Show Image 1 home screen. Cards appear sequentially and "Plan this trip" is activated.

3–7s: Transition to Image 2 itinerary page. "Day 2" becomes selected, the timeline expands, and "Optimize day" is triggered.

7–11s: Transform the timeline naturally into the map shown in Image 3. Draw the route section by section, move the location marker, and reveal the bottom navigation card.

11–15s: Transition into Image 4 review page. Expand photos, increase the statistics, illuminate Day 1 through Day 5 sequentially, and finish with a subtle button glow.

Keep the animation restrained and fluid. Avoid text deformation, element drift, or layout changes.
```

**Third-person gameplay** (tested). Camera described as part of the game system.

```
@Reference image. Third-person over-the-shoulder game camera that continuously follows the female protagonist from behind. She runs forward with powerful movement, approaches a red car, quickly opens the door, pulls the driver out, sits in the driver's seat, and closes the door. Keep the entire sequence continuous with authentic third-person gameplay camera behavior.
```

**Character-select screen** (tested).

```
@Reference image. Begin on a game character-selection screen. The cursor moves across the characters one by one while the camera pushes in for a close-up. Each character stands up and performs a signature pose, draws a weapon, or speaks a short English line. Finally select the blonde female character. She immediately strikes a pose and speaks before the interface transitions into a loading screen.
```

### Music video and stylized

**Verse and chorus pair** (untested). Identity fixed; performance, camera, and energy change with the song.

```
Female singer performs alone on a rain-soaked rooftop at night, restrained emotional movement, slow handheld push-in, distant city lights, intimate R&B mood, soft cinematic backlight.
```

```
Same singer and wardrobe beneath bright neon signs, stronger body movement, confident performance, dynamic tracking camera, vivid magenta lighting, energetic music-video cinematography.
```

**Chorus performance** (untested).

```
Same female singer in a silver jacket performing the chorus on a neon rooftop, confident body movement, slow tracking camera, strong backlight, energetic synth-pop music video style.
```

**Vertical social hook** (untested).

```
Singer hits the chorus as the room transforms into a glowing cartoon city, fast push-in camera, bold rhythmic movement, bright graphic lighting, vertical social-video composition.
```

**Style transformation** (untested).

```
Rap performer becomes a cel-shaded animated character inside a hand-drawn comic city, graffiti panels transform with the beat, exaggerated perspective, dynamic low-angle camera, bold street-art color language.
```

### Motion transfer and editing

**Character replacement** (tested). The source video carries the choreography, so the prompt stays short.

```
Use the full source video as the motion reference. Replace the monk with a 2D cartoon anthropomorphic cat and replace the other character with a 2D cartoon anthropomorphic mouse. Preserve the original video timing, action sequence, and story.
```

**Targeted edit** (tested).

```
Change the cat's eyes to blue. Replace the ocean in the background with a grassland.
```

## Sources

Distilled from the guides at minimax-h3.com: the prompt guide, best practices, reference-to-video, full-reference prompt guide, director workflow, dialogue guide, commercial video guide, product ads guide, and music video guide. Several examples in those guides are labelled by their authors as suggested starting points rather than tested results; [Example prompts](#example-prompts) marks which are which.
