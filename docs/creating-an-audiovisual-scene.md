# Creating an Audiovisual Scene

[All guides](../README.md#guides)

Use Project Workspace for a scene that travels with its characters, artwork and sound. No TypeScript is needed for ordinary authoring. Prepare character animation and root-motion keys in Animation Editor first.

## Import and audition sound

1. Open or **Import Project** in Project Workspace. Expand **Audio**.
2. Choose **Import category** (Music, Ambience, Sound effects or Voice), then **Import Audio**. WAV, MP3 and OGG are supported when this browser can decode their encoding; files are limited to 10 MiB each.
3. Expand the counted category and use the file row’s **Play / Stop** button. **Preview volume** affects this audition only. Stop it before returning to **Scene Editor**.
4. Create a scene with **+ New Scene**, or open an existing scene. Imported assets appear in the timeline’s **Audio** tab under **Audio asset**.

Audio imports store the original binary, a stable asset ID, a portable path, category and decoded media duration. Removing a referenced asset is blocked with dependency information. Renaming it keeps existing clips linked.

## Arrange music, ambience and effects

Choose **Track category**, then **Add audio track**. Select **Audio asset** and **Audio track**, set **Playhead (s)**, then **Add Audio Clip**. Add separate Music, Ambience and Sound Effects tracks for clarity. Categories organize tracks; they do not restrict asset types. Overlapping clips, even on the same track, play simultaneously.

Click a clip, open **Audio clip** in the inspector’s **Audio** tab, and edit:

| Control                      | Meaning                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| Start (seconds)              | Where the clip begins in the scene                         |
| Duration (seconds)           | Its finite scene interval                                  |
| Source offset (seconds)      | Where playback begins inside the imported file             |
| Volume (%)                   | Authored gain, from 0 through 100                          |
| Loop                         | Repeat from Source offset to media end until the clip ends |
| Fade in / Fade out (seconds) | Linear gain ramps at the clip’s scene edges                |

Choose **Apply audio clip properties** to commit the complete edit. Each fade must fit in the clip; overlapping ramps multiply. A non-looping clip cannot extend past the source file. Clip edits never silently extend scene duration. For a long music bed, enable Loop before applying a duration longer than the media.

Drag a clip’s body to move it without changing source offset. Drag the left edge to trim the start and advance source offset while retaining the scene end; drag the right edge to change duration. For loops, left trimming also changes the repeated source window. Shared **Snap** uses frames, the playhead and authored timeline edges; hold **Alt** to bypass it. A completed gesture is one Undo step; Escape cancels it. **Duplicate audio clip** creates a simultaneous copy: move it afterward to avoid doubling the sound.

## Build a short encounter

1. Add a background with **+ Add Background** under **Scene Artwork**. Use **+ Add Layer** and layer assignments for foreground artwork. Set parallax and image placement before previewing.
2. Use **+ Add Actor** twice and set each Actor’s **Initial X/Y**, Facing, Skin and Initial animation. These are independent scene instances, even when they share a character.
3. Add Music and Ambience clips at zero. Use finite loops, quieter volumes and short opening fades.
4. Select Actor A. In the timeline’s **Actions** tab add **Move to position** and **Play animation** at the same time. Set a destination and walking animation with matching durations.
5. In **Camera**, use **Set Camera Key** at the opening and **Apply camera key** at a later time to create a pan. **Set Camera Cut** holds a shot until the exact cut boundary.
6. Add a dialogue line before the attack using the steps below.
7. Schedule Actor A’s attack after the walk. Choose **Movement source → Animation root motion** if that animation has root keys. Do not overlap it with a Move action: each interval has one translation owner.
8. Scrub to the swing pose, note Playhead (s), and add the swing sound there. Add an overlapping impact sound at the contact pose. Use Source offset to skip leading silence. Preview at 1× to judge timing.
9. Optionally add a **Scene cue** action at contact with **Cue name** and JSON **Payload**. Cues are host notifications; they do not start an audio clip automatically. Put intended sound on the audio timeline. Standalone gameplay reactions use the existing runtime cue callback.
10. Add Actor B’s response animation and dialogue, followed by a closer camera key or cut. In **Transitions**, choose Fade out and **Add effect** near the scene end.

## Author dialogue and subtitles

Set the playhead and choose **Add Dialogue Line** in the timeline’s **Dialogue** tab. Select the line and open **Dialogue line** in the inspector. Choose **Speaker Actor**, enter **Dialogue text**, and set **Dialogue start / Dialogue duration (seconds)**, then **Apply dialogue properties**.

Speaker Actor references the scene-local instance. **Speaker label** overrides its displayed ID. **Narration (no Actor)** permits unassociated text. Reassign speaking lines or convert them to narration before deleting their Actor. Multiline Unicode and Japanese are plain text; markup is displayed literally. Only one subtitle interval is allowed at a time. Adjacent lines are valid: the next line owns their shared boundary. Conflicting timing edits are rejected without changing history.

**Voice reference** links a scene audio clip for organization. It never plays sound or aligns timing automatically. Author its playback separately on the audio timeline. Clear the reference before deleting that clip or track.

Use **Preview Through Camera** to inspect audience framing. Subtitles wrap inside the output safe area, stay fixed through camera movement, and render above scene fades. Keep lines short and split long passages into adjacent intervals. The default renderer bounds text to twelve wrapped lines and two speaker lines and can scale large content down; inspect Japanese font availability and readability at your intended output resolution. A custom runtime presentation target can supply different typography.

## Preview, scrub and recover

**Play** unlocks browser audio and loads the scene’s clips. **Enable audio** prepares or retries sound without starting the scene. If status reports an error, allow browser sound or reimport a supported encoding and retry. Missing sound does not invent replacement playback. **Mute preview audio** affects preview only.

Actors, root motion, animations, camera, cuts, fades, dialogue and cues use one scene clock. **Pause** holds visuals/subtitles and stops audible voices. **Play** resumes only clips active at that scene time, from their correct source position and fade progress. **Speed** changes the entire scene; audio pitch changes too.

**Playhead (s)** and ruler scrubbing always pause and remain silent. Repeated forward/backward seeks reconstruct Actor state and sample camera, fades and subtitles without dispatching gameplay events or scene cues. Use **Restart** to hear the full scene from zero and begin a fresh cue pass. **Stop** silences audio, clears dialogue and restores initial placement. Hiding the editor page pauses it.

Scene **Undo / Redo** restores authored changes; transport and preview controls create no history. Camera, artwork and audio edits retain the playhead; Actor/action/dialogue edits reset playback. Local drafts preserve binaries and authored timing. After a reload, choose **Recover Draft** when offered. A local draft is a browser recovery copy: export a ZIP for a portable disk copy.

## Export a complete scene

Use **Validate Scene**, then **Download scene package** for an independent runtime handoff, or return with **← Project** and choose **Export Project** to retain the whole workspace. Project import restores audio binaries, source offsets, volume/fades, dialogue/speakers, cues, Actors and camera data. **Download scene JSON** saves references and timing; it needs the referenced files alongside it.

The standalone runtime loads a scene ZIP with `SceneLoader.loadPackage`. Its host supplies a user-action audio enable control, a Phaser update loop and optional cue handling. Browser audio objects and temporary Blob URLs are never authored data. See [runtime integration](runtime-integration.md), [audio playback](scene-audio-playback.md) and [dialogue presentation](scene-dialogue.md).

Web Audio decodes complete files, with a 128 MiB decoded-audio budget per loader. Long compressed tracks can use much more memory after decoding; shorten them or reduce channels/sample rate if needed. Scheduling is reconciled on host updates with 80 ms drift tolerance and at most one correction per voice per 250 ms. Very short effects entirely crossed by one stalled frame are skipped; this is not sample-accurate offline rendering. There is no streaming, waveform editor, recording, synthesis or pitch-preserving time stretch.

Feature Guide’s Scene category includes **Importing Audio**, **Audio Timeline**, **Creating Dialogue**, and **Audio and Scene Timing**. These tours reveal controls and explain the workflow without changing the scene or starting sound. The Project Workspace **Importing and Managing Audio** tour highlights the actual import and audition controls.
