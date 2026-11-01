# Reusable choreography and scene templates

Scene Editor’s **Choreography & templates** command saves common timed performances and scene layouts. The **Reusable Choreography and Scene Templates** Feature Guide explains the controls without changing your document or starting playback.

## Save choreography

1. Author ordinary animation, move, facing, wait and cue actions on the scene timeline. For two samurai meeting, pair each walk animation with a move, then add facing and bow animations after the moves finish.
2. Ctrl/Cmd/Shift-click the actions across both Actor tracks. Modifier-click toggles membership; keyboard activation supports the same modifiers. Ordinary dragging still edits one action using the existing timeline gestures.
3. Open **Choreography & templates**, then expand **Save selected actions as choreography**. Give the preset a name and name its roles, for example **Samurai A** and **Samurai B**. Actors referenced only by facing targets or included dialogue also become required roles.
4. Choose position semantics and check the source origins described below. Optional camera keys, fades, audio and dialogue are unchecked initially.
5. Choose **Save Selected Actions as Choreography**. The preset owns a detached copy; subsequent source edits do not update it.

The sequence begins at the earliest selected action and ends at the latest action end. Instantaneous-only selections have a 1 ms window. Gaps, animation speed, looping, cues and JSON payloads are preserved. Animation-authored event timing stays in its shared animation asset; insertion shifts the scene action’s start without rewriting the animation.

When you include other tracks, only complete items inside this action range are copied. Camera values remain absolute scene-camera values. Audio source offsets, trim, looping, volume and fades remain unchanged. A dialogue line whose voice clip crosses the selected range rejects capture: extend your action selection to cover the complete voice clip. Cues preserve their payloads as JSON metadata; callbacks cannot be saved.

## Relative positions and root motion

**Relative to role origins** is the default. Each move destination or point-facing target shifts by:

```text
destination origin + authored source point − source origin
```

Source origins default to each Actor’s authored initial placement. If earlier actions moved an Actor before the selected sequence, enter its position at the sequence start. Destination origins default to the mapped Actor’s authored initial placement; enter its expected position at insertion time if earlier destination actions move it. Origins translate destination points; they do not teleport Actors or override the normal runtime start of a move. Facing directions and look-at-Actor targets retain their existing meanings. Relative copies do not automatically rotate, scale or mirror movement paths.

For example, a source Actor begins at X=100 and walks to X=220. With source origin 100 and destination origin 600, the copied destination is X=720. If its source position was already 160 at the selected sequence’s start, use source origin 160 to copy the remaining +60 displacement.

**Absolute scene-world positions** keeps move destinations and point-facing targets unchanged. Use this for choreography intentionally tied to scene landmarks.

Root-motion animation actions retain `movementSource: 'rootMotion'`. Their animation displacement stays in the shared clip; insertion neither bakes it into move actions nor adds it to position offsets. Root-motion translation and ordinary scene movement must have separate ownership windows. See [scene root motion](scene-root-motion.md).

## Map roles, preview and insert

1. Open another scene with compatible Actors. Expand **Insert choreography** and select the preset.
2. Assign a different destination Actor to each role. Roles are authoring metadata; inserted actions refer to the mapped scene-local Actor IDs.
3. Enter **Insertion time** in seconds and any destination origins. The entire sequence must fit within the destination scene duration. Extend the scene explicitly when needed.
4. Choose **Preview choreography**. The preview loads character metadata, checks references and builds a detached candidate without editing the destination or its history. The panel shows required Actors, duration, animation references, position semantics and translation ownership. Play or scrub the separate stage; audio is muted and cues have no host handlers.
5. Choose **Confirm insertion**. The complete copied sequence is one ordinary scene Undo/Redo step. Changing the destination, mapping, insertion time or template selection invalidates the earlier preview.

Animation reuse follows explicit shared rig identity. Project variants sharing the same rig owner are compatible when the named animations are available. Standalone reuse requires the same character manifest identity. Matching animation names alone do not authorize different rigs. Use the existing [Animation Library](animation-library.md) and [Retarget to Another Character](animation-retargeting.md) workflow to author compatible clips, then save a preset from those Actors. Insertion never silently retargets an animation.

Missing character/animation metadata, root-motion tracks without translation keys, duplicate role assignments, invalid times, movement/animation conflicts, camera interval collisions, overlapping fades, dialogue overlaps and missing audio/voice references block the proposal. Diagnostics remain visible in the panel. Shared project validation also blocks invalid export; editable library drafts may retain missing assets while you repair or remove them.

## Save and create scene templates

Expand **Scene templates**, enter a template name and choose what to include:

| Option                                   | Default         | Contents                                                            |
| ---------------------------------------- | --------------- | ------------------------------------------------------------------- |
| Scene layout                             | Always included | Duration, camera setup, backgrounds, layers and artwork placement   |
| Include Actors                           | On              | Initial positions, facing, character, animation and skin references |
| Include action, camera and fade timeline | Off             | Actor actions when Actors are included, camera keys and fades       |
| Include audio and dialogue               | Off             | Audio assets/tracks/clips and subtitle/voice metadata               |

Choose **Save Scene as Template**. To create a copy, select a template, enter a new unique scene ID and name, choose **Preview template**, then **Create Scene from Template**. The new scene is independently editable and retains the template duration. Removing Actors also removes their actions; included dialogue becomes narration with its speaker label preserved. Audio and dialogue inclusion is independent of the action/camera/fade timeline checkbox.

Copies receive fresh Actor, action, image, custom layer, camera key, fade, audio track, audio clip and dialogue IDs. Facing targets, artwork layer references, dialogue speakers and voice-clip references are remapped together. Reserved `background` and `actors` layer IDs stay fixed by the existing scene format. Character manifests, animation names, skins, image paths and audio asset IDs remain shared asset references.

Editing an inserted choreography or a scene created from a template changes only that copy. Editing shared animation, rig, artwork or audio assets still changes the asset those copies reference. There is no live preset inheritance or update propagation.

## Keep and transfer the library

In a project, the optional version-1 `sceneReuse` library lives in project metadata. **Export Project**, project autosave and recovery include it with the existing shared asset binaries. Library additions/removals participate in Project Workspace Undo/Redo; choreography insertion participates in the destination scene’s Undo/Redo. Reusable asset dependencies block character/audio removal, and retained templates protect artwork from cleanup even after the source scene is removed.

**Transfer library JSON → Download library JSON** saves the authored library separately. **Import library JSON** merges entries and rejects duplicate IDs. This file contains references, not asset binaries; move the project ZIP when you also need its dependencies. Import checks schemas, timings and local references. Preview checks destination assets and rig compatibility before insertion.

Standalone Scene Editor keeps the library in the current document owner’s memory while switching scenes. Download library JSON before leaving. Scene JSON and scene packages contain the ordinary expanded scene, without its reusable library. They remain compatible with the existing runtime and do not require a preset interpreter.

## Verification workflow

For artist acceptance, save two Actors’ walk/stop/bow sequence, insert it at a later time in a second scene with different compatible Actors, preview it, and save the result as a template. Create a third scene, modify it, then verify the template and both earlier scenes remain unchanged. Export/reload the project and check that shared assets and all copied references resolve. With standalone scenes, download/reload both scene JSON and library JSON separately.

Automated coverage includes role mapping, explicit origins, root-motion runtime displacement and conflicts, relative timing, optional camera/fade/audio/dialogue tracks, fresh identities, source immutability, one-step Undo/Redo, project ZIP/local draft round trips, retained dependencies and invalid export. A local desktop Playwright workflow exercises selection, detached stage playback/scrubbing, insertion, Undo/Redo, template creation and scene reload. Its bow slot uses the bundled idle animation; substitute a production bow clip for artistic review. Browser checks remain local-only.
