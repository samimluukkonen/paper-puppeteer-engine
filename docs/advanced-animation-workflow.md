# Advanced animation workflow

[All guides](../README.md#guides) · [Animation Editor](animation-editor.md) · [Internal v1.1 assessment](advanced-animation-readiness.md)

Start in **Project Workspace**. Create or open a project, add your character, and open its **Animation Editor**. Every step below uses the existing editor controls. Inspector sections start closed; open the section you need. **Feature Guide → Animation Editor** includes Pose Library, Graph Editor, Editing Bézier Handles, Create an Animation Variation, Running Motion Diagnostics, and Previewing and Applying Cleanup. Reading these tours never creates poses, keys, variations or cleanup reports.

## Save and reuse a pose

1. Choose **+ New Animation**, enter a unique **Animation name / ID**, duration, FPS and loop setting, and choose **Create Animation**. Select a bone in **Bones**, move **Time (s)**, edit its transform and press that property's diamond to commit a key. Yellow temporary fields are excluded from saved poses; commit or cancel them first.
2. Open **Tools → Pose Library…**. Enter **Pose name**, choose **Save scope → Full character** or **Selected bones**, and choose **Save Current Pose**. Selected bones comes from selected timeline keys, or the selected bone when there are no selected bone keys.
3. Close the library, move to another time, reopen it and select the saved pose. **Preview** shows a temporary pose; **Cancel preview** restores the animation. **Apply Pose** explicitly writes the saved properties at the playhead as one animation edit. Normal animation **Undo/Redo** restores/reapplies those keys.
4. Use **Search poses**, rename or delete to organize the library. **Undo library edit / Redo library edit** affects the library separately from animation keys. JSON clip downloads contain keys; character/project ZIPs and local drafts also retain the pose library.

Poses capture local bone transforms before IK. Animated IK targets remain unchanged. A different hierarchy, bind pose or IK configuration can make an old pose incompatible; the library explains why instead of applying it. Changing artwork alone does not invalidate a pose. See [Pose Library](pose-library.md).

## Shape motion in Graph Editor

1. Create at least two keys on one bone or IK property. Expand its timeline row and select a property key, then choose **Graph Editor** beside Timeline. **Property** chooses the channel. Timeline, graph, inspector, playhead and selection share the same animation.
2. Select a key with a following key and choose **Interpolation**. **Auto** inherits the clip's linear default; **Linear** changes at a steady rate; **Stepped** holds until the next key; **Bézier** lets you shape the transition. The final key has no outgoing segment.
3. With Bézier selected, drag the white tangent points. The canvas shows the proposed curve immediately. Releasing commits one Undo step; Escape cancels. Open **Tangent precision** to enter **Outgoing time/progress** and **Incoming time/progress**, then choose **Apply handles**. Values are normalized from 0 to 1; outgoing time cannot exceed incoming time. **Reset handles** is an authored edit.
4. Drag keys or enter **Key time (s)** and **Value**, then **Apply key**. Times stay between neighboring property keys; collisions are rejected. Rotation displays degrees and files store radians. Use **Fit graph**, zoom buttons, wheel zoom and middle-button pan to navigate without editing.
5. Play or scrub, then use normal **Undo/Redo** to compare edits. **Clip settings → Mode → Smooth / Stepped** controls how time is sampled, independently of each segment's interpolation. A smooth Bézier may still look held under stepped playback. See [Graph Editor](graph-editor.md).

## Make an independent variation

Choose **Create Variation** in the toolbar. The source is the current committed working animation, including unsaved edits. Enter an unused **New name / ID**. **Time scale** changes duration, every key and every event time together: 2 makes it twice as long. Curve handles remain normalized and FPS stays unchanged.

**Preview position** scrubs a temporary canvas comparison. Escape or Cancel discards it. **Create Variation** registers a separate **New / Unsaved** clip with its own empty history; creation itself is document creation, not an Undo step in the source. Later edits use the variation's ordinary Undo/Redo. Switch back to the source to compare: its keys and history remain independent. Existing Scene Editor clips keep their old animation IDs until you explicitly choose the variation. See [variations](animation-editor.md#create-an-animation-variation).

## Diagnose and clean up deliberately

1. Open **Tools → Motion Diagnostics…** and choose **Run diagnostics**. Findings are suggestions: fast attacks and stepped transitions can be intentional. **Inspect** selects the corresponding key and seeks its time. Changing authored data invalidates old analysis.
2. Open **Heuristics and tolerances** if needed. Positions use rig units and rotation uses radians. Changing thresholds clears the report; run again. Diagnostics measures local authored channels rather than world-space contact quality.
3. Review **Potentially redundant property keys** and uncheck keys you want to keep. **Preview Cleanup** builds the selected proposal. No candidates is a valid result: nonlinear/stepped channels, event-time keys, endpoints, IK inputs and baked rotations are protected. Cleanup is skipped above 256 keys per property; findings still run.
4. Scrub **Comparison time (s)** and switch **Before / After**. This uses the normal canvas evaluator, with no authored events, keys or history changes. Review the maximum local deviations. **Cancel preview**, Escape or closing the panel discards the proposal.
5. Choose **Apply Cleanup** only when satisfied. It rechecks the combined selection and commits one animation edit. **Undo** restores all removed property keys; **Redo** reapplies them. A tolerance failure leaves the authored animation intact; select fewer keys and preview again. See [diagnostics and safety limits](motion-diagnostics.md).

Starting another preview releases the previous preview's pose and clock. Starting playback restores authored motion. Previewing never marks a clip saved or adds preview-only data to exports.

## Recover, export and use in a scene

Wait for **Local draft saved** before a browser refresh. **Recover Draft** opens the latest valid committed local draft, including poses and variations; session Undo/Redo history starts fresh. Local storage is a convenience, so keep a disk copy with **Export Project** or **Character package → Download character ZIP**.

**Download JSON** saves the selected committed clip. **File tools → Reload Current Export** checks that snapshot, or **Import / Paste Animation JSON** imports it. Import replaces the selected document and resets its history after the usual confirmation. A character ZIP also registers new animation IDs for CharacterLoader. Existing animation version 1 remains supported; curve controls need a runtime version that supports curves.

Return to Project Workspace, choose **+ New Scene**, open **Scene Editor**, then **+ Add Actor**. Choose **Action type → Play animation**, **Add action**, open **Action properties**, select the variation in **Animation ID**, set **Action duration (seconds)** and choose **Apply action properties**. Scrub **Playhead (s)** and Play/Stop to review it. **Download scene package** gives the standalone runtime handoff; **Export Project** preserves the editable project. See [Making Your First Scene](making-your-first-scene.md).

## Troubleshooting

| What you see                                         | What to do                                                                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pose, variation or diagnostics controls are disabled | Select an animation, use Animation mode, and commit or cancel yellow fields and active drags.                                                      |
| Empty graph or disabled interpolation                | Select a bone/IK property, create two property keys, and select a key before the final key.                                                        |
| Pose does not reproduce the solved limb              | Poses store FK before IK. Review animated IK targets/influence separately.                                                                         |
| Unexpected holds after a curve edit                  | Check both segment Interpolation and clip Smooth/Stepped Mode/FPS.                                                                                 |
| No cleanup candidates                                | Protected or already minimal motion needs no cleanup; dense channels above the stated limit are skipped.                                           |
| Analysis disappears                                  | Edits, options or session changes invalidate it. Run diagnostics on the new state.                                                                 |
| A variation is missing from a scene                  | Select the correct project character, then explicitly choose its new Animation ID. Export the full character/project to retain its manifest entry. |
| Recovered edits have no Undo history                 | Complete local drafts recover committed data; live session history is not persisted there.                                                         |
