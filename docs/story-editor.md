# Visual story authoring

[All guides](../README.md#guides) · [Scene Editor](scene-editor.md) · [Dialogue](scene-dialogue.md)

Project Workspace’s **Story Sequence** panel assembles existing scenes into a linear story. No code or JSON editing is needed. Start with [Creating a Linear Story](creating-a-linear-story.md). Open **Feature Guide → Creating a Story** or **Exporting a Story** for a tour; the tours only reveal controls and never change your work.

1. Create your scenes in the project’s **Scenes** section. Use **Scene Editor** to author Actors, actions, camera, artwork, dialogue and audio.
2. In **Story Sequence**, choose **New Story**, enter a name and **Create Story**. Use the **Story** selector to switch stories. Edit **Story name** and choose **Rename Story** to apply a name.
3. Choose an **Existing scene**, then **Add Scene**. Add the same scene again for a reprise. Every entry has its own stable identity, and each playback creates a fresh runtime session.
4. Use **Up** / **Down** to reorder the sequence. Each completed move is one history operation. **Duplicate entry** inserts another reference immediately after the source.
5. **Open source scene** edits the shared scene document. All entries referencing that scene use the updated source. **Remove entry** removes only that occurrence; the underlying scene remains in the project.

## Dialogue advancement

In Scene Editor, select a dialogue clip and expand **Dialogue line** in the **Dialogue** inspector. Choose **Timed** or **Wait for Enter** under **Dialogue progression**, then **Apply dialogue properties**. Speaker, plain text and timing retain their existing controls.

Timed dialogue follows scene time. Wait for Enter freezes cinematic time at the line’s start until you press Enter or click **Advance dialogue**. Its duration affects silent scrubbing only; zero supports point holds, including a hold at scene end. A numbered **Enter** marker identifies every hold in the timeline. Holds sharing a timestamp occupy separate lanes in their runtime order: ascending, case-sensitive Line ID order. The marker number makes that sequence visible. Timed lines and unrelated intervals cannot overlap.

For a reading hold, the dialogue inspector also offers **Hold Actor** and **Actor idle during holds**. This changes the chosen scene Actor immediately, independently of the dialogue form’s Apply button. It applies to all holds in this scene, including narration or another Actor’s dialogue. The default holds the cinematic pose. An existing animation can loop its tracked pose channels as an overlay; root travel and animation events are suppressed. Choose a subtle idle that matches the held pose. See [hold presentation](dialogue-hold-presentation.md) for details.

Ordinary scene audio pauses while waiting. To add a dedicated loop, create/select a Music or Ambience clip in the Audio timeline and choose **Audio playback → Hold-only loop (music / ambience)**. Its Start/Duration window determines eligible holds; its source offset and volume determine playback. The dialogue inspector lists eligible hold audio with links to its Audio inspector. Voice references remain organizational metadata. No unsupported SFX/voice hold playback or per-line animation override is offered.

Scene Editor **Play** simulates these holds and permitted idle/audio activity. Focus the stage or another non-control editor surface to use Enter. Typing in fields, dialogs and guide interactions retains native keyboard behavior, and held/repeated Enter presses do not consume multiple lines. **Pause** suspends a hold; **Play** restores it. **Stop** and playhead scrubbing remain available. Scrubbing is always silent and never waits for input.

## Preview the complete story

Choose **Preview Entire Story**. The preview runs the actual `StoryPlayer` with scene packages built from the current project documents. Scenes play in sequence using the runtime’s cinematic camera, transitions, dialogue holds, Actor idle overlays and hold audio. Repeated entries load separate sessions; the previous session is disposed before loading the next.

Focus the preview canvas and press **Enter** once per held line, or click **Advance dialogue (Enter)**. If sound is locked, click **Enable story audio**. Browser audio permission may need to be enabled again for a newly loaded scene. **Stop story** releases the current scene, **Restart story** starts from the first entry, and **Close preview** returns to editing and releases the preview game. Closing during loading cancels the session. These are artist controls supplied by the editor; finished viewer integrations do not acquire them automatically.

**Story validation** shows problems in the selected story’s dependency graph, including missing scenes, invalid dialogue/idle references, incompatible characters, audio configuration and unsupported transitions. Open a source scene or dialogue item from its warning. Invalid edits/imports are rejected before entering history and report the offending path in Scene Editor. Empty stories are saved drafts and cannot play. Production preview/export also checks package artwork and other project dependencies.

## History, saving and recovery

Story creation, naming and sequence changes use **Undo Project / Redo Project**. Dialogue, idle and audio changes use the source scene’s Undo/Redo. Story operations never rewrite or dirty source scenes or animations. Preview, selection and guide navigation do not create authored history or save runtime state.

Committed stories use the existing project autosave and **Local draft** recovery. **Export Project** downloads a portable ZIP containing every story, shared scene and dependency; **Import Project** restores them. Recovery restores documents with fresh history, following the project’s existing behavior. Keep a project ZIP as your portable backup. A standalone scene/character download does not include project-owned story sequences.

For application integration, see the [standalone story player guide](standalone-story-player.md). It covers the React-free viewer controller, configured advance input and browser audio activation.
