# Creating a Linear Story in Paper Puppeteer Engine

[All guides](../README.md#guides) · [Story Editor](story-editor.md) · [Standalone Story Player](standalone-story-player.md)

A **scene asset** contains Actors, animation, root motion, camera, audio, dialogue and scene fades. A **story** contains ordered references to scenes and their arrival transitions. Reusing a scene does not copy it: editing that source changes every story that references it. Each playback occurrence gets fresh Actors and clocks.

## Assemble the story

1. Open **Project Workspace**, create or import a project, and author scenes in **Scene Editor**. Add characters and backgrounds, then arrange animation, camera, audio and dialogue on the timeline. Reuse compatible animations from Animation Library; retarget onto a different rig before using that resulting animation in a scene.
2. In **Story Sequence**, choose **New Story**, enter its name and choose **Create Story**.
3. Choose an **Existing scene** and **Add Scene** for each entry. Use **Up / Down** to set playback order. **Duplicate entry** repeats a reference with a fresh playback session. **Remove entry** keeps the source scene.
4. Set each **Entry transition** to **Direct cut** or **Fade through color**. For a fade, choose **Fade duration (ms)** and **Fade color**. It covers the previous scene, stays opaque while the next loads, then reveals that scene before its clock starts. For a final fade out, author a fade-out in the final scene’s Transitions timeline.

Story names, ordering and arrival transitions use **Undo Project / Redo Project**. **Open source scene** opens that scene’s own document and Undo/Redo history. Story ordering does not rewrite character rigs, animations, root motion, mesh attachments or reusable choreography.

## Author dialogue progression

In Scene Editor’s **Dialogue** timeline tab, choose **Add Dialogue Line** or select an existing line. Expand its **Dialogue line** inspector, edit text and speaker, then choose **Dialogue progression** and **Apply dialogue properties**.

- **Timed** displays the line for its authored duration and continues automatically.
- **Wait for Enter** pauses cinematic time at the line’s start and keeps its text visible until explicitly advanced. Its Duration affects silent scrubbing, not how long the viewer can read.

An opening hold at time zero waits immediately. Lines with the same start advance separately in stable **Line ID** order, indicated by numbered Enter markers. Use those IDs to order an exchange at a single frozen instant.

Focus the canvas and press **Enter** once per waiting line, or use **Advance dialogue** in Scene Editor / **Advance dialogue (Enter)** in the story preview. Holding Enter cannot repeat through lines or advance an opening line after a scene change. Separate deliberate presses each advance one line; there is no arbitrary debounce delay. Enter in text fields keeps its editing behavior. Enter during ordinary timed playback does nothing.

## Keep a reading hold alive

The main scene clock stops during a hold: Actor choreography, root motion, cinematic camera, scene fades, ordinary audio and future cues stay at the hold boundary. Resume continues from that position without catching up the viewer’s waiting time.

Choose **Actor idle during holds** in the dialogue inspector, or **Dialogue hold idle** in Actor properties. The existing animation loops as a sparse snap overlay on that Actor during every hold in the scene. Untracked pose channels stay cinematic; root displacement and animation events are ignored. Advancement restores the exact frozen cinematic pose. This is an Actor setting, not an animation edit or a setting limited to one dialogue line.

For sound during holds, select a clip on a **Music** or **Ambience** track and choose **Audio playback → Hold-only loop (music / ambience)**. Its Start/Duration window must include the hold’s start. It loops from Source offset at constant Volume and stops when that hold ends. Ordinary music does not automatically continue, and voice/SFX cannot become hold loops. Scene audio pauses and resumes at its cinematic offset. Audio ends at scene handoffs; cross-scene continuous music is not provided.

**Pause** freezes local idle time and stops voices; **Play** resumes their local phase. Stop, restart, seeking, switching scenes and closing a preview release local playback. Scrubbing evaluates only authored cinematic state, silently: it does not start hold idles, replay external cues or require input. To test time-zero dialogue again after scrubbing, choose **Stop**, then **Play**.

## Preview, save and hand off

Choose **Preview Entire Story** in Story Sequence. Enable sound with **Enable story audio** if requested, focus the canvas, then advance each waiting line. Check opening lines, same-time exchanges, camera/root motion after resuming, transitions and completion. **Stop story**, **Restart story** and **Close preview** affect the preview only.

Committed edits use the existing browser autosave; **Local draft** shows status and recovery. Recovery restores documents with fresh Undo history. Keep an **Export Project** ZIP as the editable backup; **Import Project** restores stories and source assets together.

Choose **Validate Project** and inspect **Story validation** when warnings appear. Resolve missing references through **Open source scene** before export. **Download story package** writes a viewer ZIP containing the selected story, scenes and required character/image/mesh/audio data, sharing identical binaries. It does not replace an editable project backup or mark it exported.

A standalone application loads that ZIP with `StoryPackageLoader.load`, supplies the result to `StandaloneStoryPlayer`, then loads/plays the story and focuses its viewer. See the [portable package integration](story-handoffs-and-packages.md) and [standalone API example](standalone-story-player.md). The authoring application has no standalone story-ZIP upload view. The host owns Phaser’s frame loop and game cleanup; the viewer owns its scene sessions and input. When audio is locked, its first Enter press unlocks audio and leaves the line visible; release and press again to advance.

## Troubleshooting

| Symptom                                      | Check                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enter does nothing                           | Playback must be waiting, with focus on the canvas/viewer. Typing controls, modifiers and held-key repeats do not advance.                                         |
| Opening line disappears during editing       | Silent scrubbing is a passive sample. Stop and Play to start a new interactive pass.                                                                               |
| Wrong line appears first at the same start   | Check stable Line IDs and the numbered Enter markers.                                                                                                              |
| No sound                                     | Use Enable story audio; verify the clip window, track category and playback policy. Browser activation can require a deliberate gesture.                           |
| Idle moves the character across the stage    | Hold idles ignore root motion; check whether the intended cinematic movement resumes after advancement. Use a subtle compatible idle for hold poses.               |
| Another story changes after dialogue editing | Both entries reference the same source scene. Make a separate scene asset for independent content.                                                                 |
| Export or preview is disabled                | Add at least one valid scene, resolve Story validation errors, and complete/cancel temporary edits.                                                                |
| Long delay at a handoff                      | Check image dimensions, mesh complexity and audio size. Only current/next runtime assets are prepared, but the complete portable archive is validated when opened. |

Feature Guide includes **Creating a Story**, **Dialogue Advancement**, **Idle Animation & Audio During Dialogue Holds**, and **Exporting a Story**. These tours reveal the existing controls and preserve authored data; perform their steps after exiting the tour.
