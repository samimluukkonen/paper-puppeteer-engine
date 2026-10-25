# Visual root-motion authoring

[All guides](../README.md#guides) · [Animation Editor](animation-editor.md) · [Runtime root motion](root-motion.md)

Root motion translates the whole character independently of its skeleton. Use it for steps, lunges, jumps and dodges while keeping pelvis bob, arm swings and weapon poses in ordinary bone tracks. Open **Feature Guide → Animation Editor → Visual Root Motion** for the five-step in-app tour. The tour reveals controls without changing your animation.

## Controls

The timeline starts with a distinct **Root Motion** group and **Position X / Position Y** rows above skeletal and IK tracks. These rows also appear for old or empty animations; selecting them does not create data. Open the initially collapsed **Root Motion** inspector for numeric controls.

- **Add root position key** stores both evaluated coordinates at the playhead. **Set position key** stores the entered Position X/Y in one Undo operation. Existing values on those axes at that time are replaced.
- Select an axis key in the timeline to select its channel and seek to its time. Drag horizontally to retime; frame snapping follows the existing timeline setting, and Shift bypasses it. Neighbor crossings/collisions are rejected, preserving other-axis keys. Escape cancels a drag. **Key time (s)**, **Key value**, and **Apply key** provide precise edits.
- **Delete key**, the timeline Delete button, or Delete/Backspace removes the selected axis. A Y key sharing the same time survives deleting X. **Duplicate key** copies the selected value and outgoing curve to a different playhead time, or one editor frame later when the playhead remains on the selected key. Occupied destinations and times beyond the clip are rejected. Root clipboard/group selection is not included.
- **Edit Root Motion** enables the purple square with an inner diamond at the character origin. Drag it to create/update both axes at the held playhead. Release commits one Undo operation; Escape, blur, hidden document, animation switch, seek or editor mode change cancels. The tool consumes left clicks before ground, contact, IK and bone picking. Turn it off to resume normal picking. Middle drag pans; wheel zooms outside a gesture.
- **World displacement** selects **Authored Root Motion**, **Preview-Only Displacement**, or **No World Displacement**. Only one translation source applies. Leaving Authored Root Motion exits root editing. Bone translation and IK continue in all modes. **Show root trajectory** controls the sampled path and key dots without changing keys.
- **Root loop behavior** selects **Reset each cycle** or **Continuous travel** when Loop preview is enabled. These preferences are saved per clip in local drafts/project ZIPs and excluded from production animation exports.

With a root channel selected, **Graph Editor** exposes Root Position X and Root Position Y. Its existing graph point selection, time/value dragging, precision forms, Auto/Linear/Stepped/Bézier outgoing interpolation and tangent handles work on these channels. The last key has no outgoing segment. Graph gestures use one Undo operation and Escape cancellation. Arrow keys nudge the selected root key using the editor FPS.

## Sword-attack walkthrough

1. Select or create a clip. For continuous travel, choose Smooth in Clip settings. At time 0, open Root Motion and set Position X = 0, Y = 0; choose **Set position key**.
2. Turn root editing off. Animate anticipation on the pelvis, torso and sword arm using ordinary bone keys.
3. At the beginning of the step, for example 0.25 s, choose **Add root position key** to hold the starting position.
4. Advance to 0.6 s. Enable **Edit Root Motion** and drag the square forward, or enter X = 80 and Y = 0 and choose **Set position key**. Numeric values are easiest for an exact 80-unit step.
5. Disable root editing and continue the sword-cut pose on the skeletal tracks. At the end of the clip, add another root position key at X = 80, Y = 0 to hold the landing position.
6. Select the step's X key and open Graph Editor to shape the acceleration with an outgoing Bézier curve. Select Y to add lift for a jumping attack if wanted.
7. Enable a ground reference, then scrub forward and backward. The character travels across fixed ground; the pelvis still moves within the skeleton, and arms, attachments and IK continue through the normal preview pipeline. This does not lock feet automatically.
8. Undo/Redo a root edit. Export the animation JSON and use Reload Current Export to verify values and curves. Character/project packages also retain authored root keys. Save the downloaded artifact as usual.

## Coordinates and playback

Authored X/Y are absolute offsets in unscaled, canonical right-facing character units. Positive X points right, positive Y down. Facing and the puppet's scale/rotation project those offsets into preview world space exactly once; bone parents, pelvis animation and IK targets do not define this origin. The handle reverses camera zoom/pan and the full placement affine transform. Singular transforms cannot be dragged.

The editor and runtime both measure displacement from the first root sample. The preview shares the skeletal pose's held sample time and exact endpoint. Root dragging overlays a provisional position at the held playhead even during stepped playback. Scrubs set placement from the session's placed preview origin and start in cycle zero, independent of earlier navigation. Continuous playback adds completed cycles times the net end-minus-start displacement using the runtime evaluator; repeated sampling never accumulates movement. Pause/resume retains travel and Restart clears it. Root editing shows the first cycle and suspends Environment Preview follow updates.

Ground and background remain fixed in world coordinates. Fixed camera holds its configured center; Follow Character uses the same evaluated world displacement as the Puppet, including facing, scale and rotation. The background scrolls on screen under Follow while retaining its world transform. Existing foot markers show final post-IK world positions and signed ground distance; they do not establish planted contacts or change IK.

Preview-only trajectories use world pixels independent of facing/scale, and replace authored root translation during preview. **No World Displacement** suppresses both translation sources while keeping skeletal animation. See [trajectory copying](motion-preview.md) for the explicit preview/apply workflow. Root trajectories and handles never become exported character artwork. There is no root extraction, physics, foot locking, root rotation/scaling or scene choreography authoring here.

## Implementation and verification

`rootMotionEdits.ts` owns validated sparse-property edits and duplication. `AnimationEditorState` coordinates root selection, view preferences and provisional XY snapshots with the existing playback and document/history boundary. `graphEditor.ts` extends the existing typed channel union and sampler; `GraphEditorController` uses its ordinary controls for root channels. No second interpolation engine is introduced.

`RootMotionController` owns timeline markers and numeric controls. Root lanes are excluded from skeletal marquee row indices. `AnimationEditorRootHandle` owns the Phaser overlay, camera-to-root conversion and gesture lifecycle; its graphics and listeners are released with the preview. `rootMotionCoordinates.ts` shares affine projection/inversion. `AnimationEditorPreview` sets outer placement before sampling/synchronizing the normal pose and IK, without modifying their authored tracks. Scene rebuilds recreate the handle and cancel pending gestures.

`tests/rootMotionAuthoring.test.ts` covers legacy creation, XY edits, sparse deletion, duplication/curves, retiming collisions, Graph Editor sampling, history, transformed dragging, cancellation, stepped scrubs, looping and export/reload. The existing scene regressions cover ground and preview lifecycle; `tests/browser/animationRootMotion.spec.ts` exercises the artist controls, real rendered handle, timeline, Graph Editor, export/reload and guide on desktop. Browser tests remain local-only.

Verification used one test worker per runner, with unit and browser commands run sequentially. Package and lockfile stay at the existing higher version, **1.2.6**; the changelog records this milestone under **1.1.7-3**.

| Command                                                                                               | Result                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                                                                   | Passed.                                                                                                                                                                                                            |
| `npm test -- --maxWorkers=1`                                                                          | 3,672 passed, 47 skipped; 210 files passed, six skipped; 141.88 seconds.                                                                                                                                           |
| `npm run check`                                                                                       | Formatting, lint and strict TypeScript passed.                                                                                                                                                                     |
| `npm run build`                                                                                       | Application, library, declarations and renderer-independent Node entry checks passed. Existing Lucide `use client` bundler warnings remain.                                                                        |
| `npm run check:version`                                                                               | Package, lockfile and changelog agree on 1.2.6.                                                                                                                                                                    |
| `git diff --check`                                                                                    | Passed.                                                                                                                                                                                                            |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationRootMotion.spec.ts --workers=1` | Six passed across desktop development and production builds: root-step authoring, rendered handle/cancellation/history, graph/export/reload, guide integrity, timeline dragging and keyboard duplication/deletion. |
