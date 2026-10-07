# Workflows by use case

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

## Contents

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

## Commercial planning

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

## Minimalist product ads

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

## Premium and fast-cut commercials

- For fast cutting, define two visual anchors, character identity and product identity, and let camera distance, silhouette, lighting, and framing change aggressively around them.
- Never let one cut introduce a new character, product angle, location, and style together.
- Name the specific parts of the product worth showing (for headphones: shape, material, earcups, hinges, fit), since priorities differ by product.
- Leave clean composition space where text or branding will be added later.
- Do not let cinematic effects hide the product or the campaign message.

## UGC-style ads

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

## Creative variants

Generate hypotheses, not duplicates. Decide what each version tests.

| Variable | Version A | Version B | Version C |
| --- | --- | --- | --- |
| Hook | Pain point | Surprise | Lifestyle |
| Creator | Fashion-focused | Everyday user | Expert-style |
| Product angle | Benefit | Demonstration | Value |
| CTA | Shop now | See how it works | Limited offer |

Change one big idea at a time: same product and offer with a different hook, or the same hook with a different persona. Each combination of creator reference, product reference, and storyboard is its own generation; format stays constant.

## Product demos with UI and hands

Every interaction needs a visible reaction. Break the demo into micro-actions:

```
Tap → Change → Pause → Tap → Confirm
```

- Prepare a first-frame UI reference and a hand-position reference; define logo and CTA elements in advance.
- Supply product variants (for example black and white earbuds) as separate references when a color change is the feature.
- Generate each short action as its own section and combine them.
- Expect to refine finger placement, transition effects, button bounce feedback, and cart animation after the first pass; hand–object overlap and weak feedback are the usual first-version faults.
- Clear interaction feedback matters more than extra camera movement or effects.

## Localized ads

Localization changes the context, not just the words: `Language + Persona + Humor + Scenario + Product truth`.

Ask first what situation will feel familiar to the audience, then decide `Hook → Persona → Humor → Language`. Do not translate an English script word for word. One Thai coffee ad was rebuilt around an office "Monday personality switch" (`Low energy → Work errors → Coffee discovered → Coffee prepared → Energy restored`) with game-style overlays (ERROR, ITEM FOUND, LOADING WORK MODE, LEVEL UP), Thai voiceover, and office ambience.

## UI, web, and game interfaces

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

## Music videos

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
- Use first and last frames to plan transitions between clips. That mode cannot take an audio reference in the same request (see [Limits](../SKILL.md#limits)), so such a clip will not have the song section attached. If a scene fails, regenerate that scene.

## Stylized and mixed-media video

Define both what changes and what survives the change.

```
Same subject + same action direction + changing visual layer
```

- Style can change; identity should not change by accident. Do not let an animated subject silently become a live-action person after a cut.
- "Mixed-media style" does not explain a transition. Describe the mechanism: an occlusion (clouds or an object covering the lens), an action match, a whip pan.
- Camera imperfections are a style tool: phone-camera shake, exposure fluctuation, delayed autofocus, DV noise, scan lines.
- Describe typography as part of the motion and tie kinetic text to specific actions.
- Define pacing before individual shots when the piece is a teaser or montage.

## Dialogue and voiceover

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

## Motion transfer and video-to-video

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

## Targeted video edits

```
Change X → Replace Y → Preserve everything else
```

Keep the instruction narrow: "Change the cat's eyes to blue. Replace the ocean in the background with a grassland." Do not bundle a local edit with changes to camera, action, lighting, pose, or timing; once everything changes it is no longer an edit.

## First and last frame

Suited to product transformations, before-and-after scenes, environment changes, fashion transitions, poster animation, visual reveals, and controlled shot endings.

Not "Turn Image 1 into Image 2" but:

```
Starting state → visible physical change → evolving structure → final state
```

- Use one continuous camera path between the frames.
- Name the details that must match at the end: framing, pose, product placement, light direction.
- Cannot be combined with reference images, videos, or audio in the same request.

## Character consistency

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

## Multi-clip and long-form

A longer video is a sequence, not one oversized prompt.

- Each clip has one purpose, a defined start, a defined end, only the references it needs, and continuity with its neighbors.
- Split by story blocks. One 30-second anime promo used two 15-second generations: world, entrance, and first clash; then escalation, energy burst, and final pose.
- Build anchors first: prepare style references and keyframes for the major moments (confrontation, entrance, clash, close-up, explosion, final pose), then generate the sections that connect them.
- Give a running visual thread to long experimental pieces. One one-minute film used a sideways-running character linking street footage, silhouette masks, and graphic space, with three anchor images for opening, silhouette, and closing text.
- Rewrite risky or over-specific wording into plain visual language: original descriptions instead of IP-like names, and "fast horizontal tracking, beat-cut flashes, motion through graphic space" instead of "copy the camera movement".
- After generation, the work shifts to transitions, pacing, identity, and continuity. Regenerate only the weak section.
