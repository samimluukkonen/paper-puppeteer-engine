# Reusing Animations and Scenes

[All guides](../README.md#guides)

Use **Project Workspace** for a complete reusable-asset workflow. **Export Project** saves a portable editor archive; browser autosave is a local recovery copy. Neither writes back over imported source files.

## Choose shared assets or independent copies

| Operation                             | What stays shared                                | What you can edit independently            |
| ------------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| **Use Existing Animation**            | Original character animation                     | Scene action timing and playback options   |
| **Create Independent Copy**           | Character rig and artwork                        | New animation keys, events and metadata    |
| **Retarget to Another Character**     | Target character rig and artwork                 | New target animation                       |
| **Reuse shared rig and animations**   | Owner's rig, skins, artwork and animations       | Variant name and selected appearance       |
| **Create Independent Character Copy** | Image binaries until replaced                    | Copied character documents                 |
| **Confirm insertion**                 | Referenced characters and animation/audio assets | Inserted scene actions and included tracks |
| **Create Scene from Template**        | Referenced character, image and audio assets     | New scene layout and timeline              |

Editing a shared animation changes every Actor that references it. Copy before making shot-specific corrections. Presets and templates are snapshots: editing their scene copies never changes the original snapshot. Their referenced shared assets still have one owner.

## Reuse a sword cut on another character

1. Add Samurai A and Samurai B to the project. Open A's sword-cut animation and finish temporary edits. In **Animation Library**, use **Search animations** and **Preview animation** to inspect its motion. Preview leaves source keys unchanged and suppresses events.
2. Choose **Compatible character / rig** and optionally **Compatible rig only**. Direct reuse requires the same explicit shared rig identity. Matching bone names on independent characters is insufficient.
3. For B's different proportions, choose **Retarget to Another Character**, then **Target character**. Choose a saved **Bone mapping**, or **Open Bone Mapping Editor**. Review **Auto Suggest**, fix ambiguous/unmapped rows, **Validate**, then **Save Mapping**. A valid map preserves direct parent relationships and maps the skeletal roots. Rig changes can make it stale; review current revisions and save again.
4. Set **Local translation** and **Root motion**. Local translations use rest-relative deltas, optionally scaled by each bone's length. Root motion is separate whole-character displacement: preserve it, scale it to character size, or omit it. Optional **Pelvis / body translation override** requires explicit source bones. Retargeting preserves duration, curves and event timing.
5. Choose **Preview Result**. Scrub **Comparison time**, use **Play/Pause** and **Playback speed**, and inspect both characters at the same world scale. Turn on **Show ground reference**, **Show foot contact markers** and **Show bones** as needed. Check root travel, sliding, floating and pelvis height. Review all **Diagnostics** and skipped tracks before accepting.
6. Choose **Create Animation**, then correct B's new clip in **Animation Editor**. Ordinary **Undo/Redo** applies to corrections. Return to A's sword cut to confirm it remains unchanged. Option or map changes regenerate a preview from the captured source; reopening retargeting captures later source edits.

**IK:** **FK-only transfer** omits source IK keys and suppresses every target constraint on the result. Bake source IK first if you need its solved motion. Bone mapping does not convert IK target coordinates. Foot contact markers are diagnostics; there is no automatic foot locking.

**Facing and rest pose:** rotation and translation transfer in corresponding parent-local axes. Different rest orientations can change world paths. Facing remains an Actor transform; it is not baked into the new clip. Changing rest-scale reflections needs an explicit mirror conversion and is rejected by the retargeter.

**Meshes:** target bone-weighted skinning continues working. Corrective vertex keys transfer only with an identical complete effective rig/bind basis and a complete identity bone map. Similar attachment names or vertex counts are insufficient. Different topology, proportions or bind data omit corrections with diagnostics. Rigid-to-mesh transfers can animate the target skeleton; mesh-to-rigid transfers omit source corrections. Mesh artwork replacements must preserve image dimensions and pivot.

See [retargeting math and policies](animation-retargeting.md) for exact rules.

## Make another appearance

Choose **Create Character Variant** on the base character. Select **Reuse shared rig and animations**, choose **Appearance skin**, and create it. Use **Appearance only** later to switch its selected skin. **Edit Shared Rig** and **Edit Shared Animations** open the owner and affect every variant; the header identifies affected characters. Use **Create Independent Character Copy** for private skeleton or artwork edits.

For a reusable character starting point, enable **Reusable template** on an independent character and choose **New from Template**. The created character has independent documents. Add both original and variant to a scene with **Add Actor**; each Actor has its own clock, pose and placement. Reopen a retained scene after changing shared character assets to load their current runtime definitions.

## Reuse the attack and reaction as choreography

1. In Scene Editor, add both samurai. Create A's attack and B's reaction with the existing animation actions. Root-motion clips and scene move actions must have separate translation ownership windows.
2. **Ctrl/Cmd/Shift-click** the actions, open **Choreography & templates**, expand **Save selected actions as choreography**, name the preset and its Actor roles, then save. Timing becomes relative to the first action. Camera keys, fades, audio and dialogue are opt-in; only complete items inside the selected range are included. Cues retain their JSON payloads.
3. In another scene, expand **Insert choreography**, select the preset, assign a different compatible Actor to each role, and set **Insertion time**. Different-rig Actors need retargeted clips and a preset authored from those compatible Actors; insertion does not retarget automatically.
4. For **Relative to role origins**, enter each source Actor's actual position at the sequence start if earlier actions moved it. Enter destination origins at insertion time for the same reason. Origins translate move destinations and point-facing targets; they do not teleport Actors. **Absolute** preserves scene-world points.
5. Choose **Preview choreography**, inspect playback and scrubbing, then **Confirm insertion**. Confirmation creates one scene Undo step. Scrub forward/backward to the same time and compare Actor poses, positions and camera framing. Passive seeks do not start audio or deliver scene cues/animation events; Play uses normal scene audio and cue behavior.

## Save a scene template

In **Choreography & templates → Scene templates**, choose whether to include Actors, timeline, audio and dialogue, then **Save Scene as Template**. Select it, enter a unique scene ID and name, **Preview template**, then **Create Scene from Template**. Edit the new shot independently. Actor/action IDs, camera keys, dialogue speakers and voice links are remapped together; shared asset references remain intact.

## Save, recover and hand off

**Local draft** shows browser save status. Recovery preserves authored clips, mappings, variants, presets, templates and referenced binaries; it does not mean a portable file was saved. **Export Project** / **Import Project** keep the complete workspace. Use **Validate Project** before handoff and repair its dependency errors.

For runtime playback, use **Download scene package** and `SceneLoader.loadPackage` in your Phaser application. The package contains ordinary expanded scene data and materialized character assets, including variants and retargeted clips. No editor preset interpreter is needed. A project ZIP is an editor archive, not a standalone scene package. See [runtime integration](runtime-integration.md).

Standalone Scene Editor libraries live in memory: also use **Transfer library JSON → Download library JSON** before leaving. Library JSON contains references, not binaries. Keep its dependencies or transfer the full project ZIP.

## Troubleshooting

| Symptom                       | Action                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Reuse/copy disabled           | Check the compatible character and explicit rig identity; use retargeting for independent rigs.                                           |
| Preview or creation disabled  | Finish temporary edits; review/save the current mapping; regenerate **Preview Result** after changing options.                            |
| Foot sliding or wrong reach   | Review proportions/rest orientations, bake source IK if needed, then correct the target clip.                                             |
| Mesh corrections missing      | Read `mesh-omitted`; author target-specific corrections for unverified bind data or topology.                                             |
| Wrong choreography placement  | Check source/destination origins and earlier movement; ensure root motion owns translation only once.                                     |
| Insertion fails               | Check duration, distinct role mappings, available animation metadata, movement conflicts, camera intervals and audio/dialogue references. |
| Asset removal blocked         | Remove or replace references in scenes, variants, mappings, presets and templates first; use **Validate Project** to locate them.         |
| A scene cannot see a new clip | Return to Project Workspace and reopen the scene to refresh character runtime definitions.                                                |

The Feature Guide catalog includes **Finding and Reusing Animations**, **Retargeting an Animation Visually**, **Creating Character Variants and Templates**, **Reusable Choreography**, and **Scene Templates**. These Explain tours reveal actual controls without creating assets, inserting copies or starting playback.
