# The six-part full-reference format

Use this structured format when several assets have different responsibilities in the same generation and the workflow exposes, accepts, or generates the full H3 reference syntax (API-style and ComfyUI workflows, prompt builders). Web generators often show simpler names such as `@image1`; follow whatever labels the tool displays. Simple single-image tasks do not need this format.

Typical triggers:

- One image defines a character's face and clothing, another the location or product.
- A video demonstrates movement, camera timing, or editing rhythm.
- An audio file provides a voice, beat, line, or sound texture.
- Some details must stay while others move to a new subject or setting.
- Existing footage must be edited or continued, not just used as inspiration.

## Labels

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

### Subject or Picture

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

### Video and Audio

- A person or action borrowed from footage is still a Subject. Use the Video label for the clip's role as source footage, or for its overall timing, cuts, and camera structure.
- A video does not need an Audio label merely because its file has sound.
- For audio, distinguish reusing the recording from following its voice, rhythm, or texture.

## Sections

| Section | Question it answers |
| --- | --- |
| `subject_definitions` | What does each Subject, Picture, Video, or Audio label mean? |
| `summary` | What kind of target video is being created, and how do the references contribute? |
| `retention_analysis` | Which traits are preserved, changed, transferred, copied, or loosely followed? |
| `detailed_description` | What happens visually and audibly from beginning to end? |
| `overall_soundscape` | Which environmental, physical, and non-verbal sounds fill the scene? |
| `non_diegetic_music` | What background score can the audience hear outside the scene itself? |

The chain: define the assets → explain the task → set preservation rules → direct the timeline.

## Retention markers

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

## Template

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

## Building one

1. **Make a reference map** before writing prose. One primary responsibility per source:
   - Character image → identity and clothing
   - Studio image → environment and lighting
   - Motion video → performance movement and camera timing
   - Voice sample → timbre and delivery for new dialogue

   The map exposes competing references and unnecessary assets.
2. **State what remains and what changes** with one retention entry per defined item, including where it appears.
3. **Write events in playback order**: opening composition, then actions, reactions, camera movement, cuts, dialogue, and synchronized sound.

## Worked example

Character, motion, and voice. The source guide presents this as an illustration of structure, not a tested generation.

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

## Common mistakes

| Mistake | Correction |
| --- | --- |
| Making every reference image a frame anchor | Use a Subject for reusable content; give a Picture its own entry only when it anchors a frame, composition, or storyboard |
| Labelling a person from a video as the Video | Define the person as a Subject; use the Video label for footage, camera timing, or edit structure |
| A label changes meaning between sections | Keep the reference map beside you; when a reference changes, update every section |
| `fully_copy` used when only the voice quality is wanted | Use `reference` and describe timbre, pace, delivery |
| A Subject defined with no retention rule | Add an entry stating where it appears, what stays, what may change |
| A plot summary in place of a shot description | Describe visible actions, camera, sound, and the ending; replace "a dramatic reveal" with what is actually seen and heard |

When asking an LLM to draft this format, supply the reference map, duration, required dialogue, and fixed traits, then check label consistency and conflicting instructions yourself.
