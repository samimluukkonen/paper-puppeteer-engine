# Paper Puppeteer Engine — v0.5.8.7
## Create Animation from Scratch

You are continuing development of my Paper Puppeteer Engine project.

**Current completed milestone: v0.5.8.6**

Technology stack:
- React + TypeScript (strict)
- Phaser
- Vite
- npm
- ES modules

The project already includes a comprehensive Animation Editor, Rig Editor, character loader, animation schema, JSON import/export, character-package export, IK, mirroring, onion skinning and Undo/Redo.

Do NOT rebuild those systems.

---

## Goal

Implement **v0.5.8.7 — Create Animation from Scratch**.

Currently, the Animation Editor workflow relies on having an existing animation JSON definition.

I want an artist to be able to create a completely new animation directly in the Animation Editor, without an existing animation JSON file.

The only prerequisite should be a valid character rig.

The workflow should be:

```text
Load character rig
       ↓
Open Animation Editor
       ↓
Click "New Animation"
       ↓
Enter animation properties
       ↓
Create
       ↓
Empty animation timeline
       ↓
Create bone/IK keyframes
       ↓
Preview animation
       ↓
Export animation JSON
       ↓
Include animation in character package
```

The new animation must behave exactly like an imported animation after creation.

## 1. Inspect existing architecture

Before implementation, inspect:
- AnimationDefinition type/schema
- Animation Editor session initialization
- Character workspace/document ownership
- Animation selection/list handling
- Existing animation validators
- Default bind/rest pose handling
- Working-copy and immutable source patterns
- Undo/Redo and dirty-state lifecycle
- Character manifests and package export
- React editor components

Reuse existing types and services.

Do not invent a second animation format.

## 2. New Animation button

Add a clearly visible button to the Animation Editor:

**+ New Animation**

It must be available:
- When the loaded character has existing animations
- When the character has NO animations
- When no animation is currently selected

Do not require an existing animation to initialize the editor.

If no rig is loaded, disable creation with a clear explanation.

## 3. React creation dialog

Clicking New Animation should open a dialog.

Suggested UI:

```text
CREATE NEW ANIMATION

Animation name:
[ Walk Cycle           ]

Animation ID:
[ walk-cycle           ]

Duration:
[ 1.0 ] seconds

Animation FPS:
[ 12 ]

Loop:
[x] Enabled

[ Cancel ] [ Create Animation ]
```

Use the actual animation schema and existing React form components.

Only expose properties supported by the current format.

Recommended defaults:
- Duration: 1 second
- FPS: 12
- Loop: enabled, if supported by the schema
- Empty keyframe tracks
- Empty event collection
- No authored IK target keys

Allow these defaults to be changed before creation.

## 4. Animation ID handling

Each animation must have a stable identifier.

Validate:
- Non-empty name/ID where required
- Duplicate IDs within the current character
- Invalid identifier characters
- Invalid duration
- Invalid FPS

If appropriate, generate an ID automatically from the display name.

Example:

```text
Display name: Sword Attack
Animation ID: sword-attack
```

Do not silently overwrite an existing animation.

## 5. Create a valid empty AnimationDefinition

Implement a centralized factory.

Conceptually:

```ts
createEmptyAnimation(
  rig,
  options
): AnimationDefinition
```

Use the actual existing schema.

The result must pass the existing animation validator.

Do not require an existing animation JSON file or clone another animation.

Do not introduce another schema just for newly created animations.

## 6. Initial pose

A new animation should initially display the character's existing bind/rest pose.

The timeline should be empty.

Do not automatically create transform keyframes for every bone.

The artist should be able to select a bone and explicitly create the first keyframe using the existing authoring tools.

Example:

```text
New animation created

Time: 0.0
Pose: character bind pose

Tracks:
  torso
  head
  leftUpperArm
  leftForearm
  rightUpperArm
  rightForearm
  ...

No authored keyframes yet.
```

Use the existing evaluator's missing-track fallback behavior.

Do not copy procedural IK results into initial keys.

## 7. Initialize Animation Editor session

After clicking Create:

- Register the new animation in the active character workspace
- Select the new animation
- Initialize its working copy
- Initialize its source/baseline state
- Reset currentTime to 0
- Pause playback
- Reset stale key/event selections
- Reset animation-specific transient drag state
- Display the empty timeline
- Display the bind/rest pose in Phaser

Follow existing editor session and history conventions.

## 8. New-document dirty state

A newly created animation has not yet been exported or saved.

It should be distinguishable from a loaded, unchanged animation.

For example:

```text
Animation: walk-cycle
Status: New / Unsaved
```

Creating a document should not incorrectly count as an edit to another animation.

Subsequent keyframe edits must use the normal Undo/Redo history.

Do not let Undo accidentally erase the previous animation document or corrupt workspace registration.

## 9. Normal animation authoring

Immediately after creation, all existing Animation Editor features should work:

- Bone selection
- Transform editing
- Creating keys
- Moving keys
- Copy/paste
- Multi-selection
- Interpolation
- Animation events
- IK target authoring
- Onion skinning
- Mirroring
- Playback and scrubbing
- Undo/Redo
- JSON export

Do not introduce a special reduced-functionality "new animation" mode.

## 10. Animation list integration

The new animation should appear in the existing animation selection UI immediately.

Example:

```text
ANIMATIONS

idle
walk
attack
walk-cycle (New)
```

Selecting another animation and returning to the new animation should preserve unsaved work.

Support creating multiple animations in one editing session.

Prevent duplicate identifiers.

## 11. Character package integration

A new animation should be available for inclusion in the existing character package export workflow.

The exported character manifest must reference its animation file appropriately.

Example:

```text
characters/hero/
  character.json
  rig.json
  animations/
    idle.json
    walk-cycle.json
```

Use actual manifest conventions.

Do not require a user to manually modify JSON merely to register a newly created animation.

If the existing package exporter only handles animations loaded from files, extend it to include valid new in-memory animation documents.

Do not pretend browser downloads automatically write into the source repository.

## 12. Export animation

The newly created animation must support:

- Validate
- Copy JSON
- Download JSON
- Character package export
- Import/reload

Use existing serialization.

Its output must be structurally indistinguishable from an equivalent imported animation.

## 13. Empty animation behavior

A valid animation may contain no keyframes.

Verify:
- Timeline renders
- Playback does not crash
- Scrubbing does not crash
- Default pose remains valid
- Events can be added
- IK keys can be added
- Export works if schema permits empty animations

If the current schema prohibits an empty animation, make the smallest justified backward-compatible change rather than inserting meaningless dummy keys.

## 14. Unsaved changes protection

If an artist creates an animation and then:
- Switches character
- Reloads the workspace
- Imports another animation
- Closes the editor
- Deletes the new animation

protect their unsaved authored work according to existing document-session conventions.

Do not silently discard the animation.

## 15. Error handling

Handle:
- No rig loaded
- Invalid rig
- Duplicate animation ID
- Invalid duration/FPS
- Schema validation failure
- Animation registration failure
- Export failure

Create should behave transactionally.

A failed creation must not leave a partially registered animation or broken editor selection.

## 16. Tests

Add automated tests for:

### Creation
- New animation with a valid rig
- Creation without an existing animation JSON
- Character with zero animations
- Character with several animations
- Multiple new animations

### Data
- Valid AnimationDefinition
- Empty tracks/events
- Bind/rest fallback
- Duration/FPS defaults
- Duplicate ID rejection
- Invalid input rejection

### Editor
- Correct selection after creation
- currentTime reset
- Playback paused
- Timeline initialized
- First keyframe authoring
- Undo/Redo
- Dirty/new-document state
- Switching between animations

### Serialization
- Export/import round trip
- Character manifest registration
- Package export including newly created animation
- CharacterLoader runtime compatibility

### Safety
- Existing animations unchanged
- Rig unchanged
- Failed creation atomicity
- No stale React/Phaser listeners

## 17. Manual workflow verification

Test this exact scenario:

1. Start with a valid character rig and NO animation JSON files.
2. Open Animation Editor.
3. Confirm New Animation is available.
4. Create "idle" with duration 1 second and 12 FPS.
5. Verify empty timeline and bind pose.
6. Select head bone.
7. Create a rotation key at 0.0.
8. Create another rotation key at 0.5.
9. Create another key at 1.0.
10. Play the animation.
11. Adjust interpolation.
12. Export idle.json.
13. Reload idle.json.
14. Confirm identical authored animation.
15. Export the complete character package.
16. Load it through CharacterLoader.
17. Verify Puppet can play "idle".

Also verify adding a second new animation to the same character.

## 18. Scope restrictions

Do NOT implement:
- Automatic animation generation
- AI-assisted animation
- Motion capture
- Animation templates library
- New IK algorithms
- Rig reconstruction
- Scene choreography

Focus only on creating an empty, valid animation and integrating it with existing editor workflows.

## 19. Required verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix ALL failures.

Run existing additional lint/E2E commands where available.

Do not claim manual testing was performed unless actually exercised.

---

## Definition of done

v0.5.8.7 is complete when:

- User can create a new animation without an existing animation JSON file
- Only a valid rig is required
- New Animation button is available in empty states
- Creation dialog supports essential animation properties
- IDs and inputs are validated
- A valid empty AnimationDefinition is created
- Timeline initializes correctly
- Initial preview shows the bind/rest pose
- No dummy keyframes are required
- Normal animation authoring works immediately
- Multiple new animations can coexist
- New animations participate in working-copy/history/dirty-state lifecycle
- JSON export/import works
- Character package export includes new animations
- CharacterLoader can play the exported animation
- Existing rigs and animations remain unchanged
- Tests, typecheck and build pass

## Final report

Provide:
1. Implemented functionality
2. New Animation UI
3. AnimationDefinition factory design
4. Initial pose and timeline behavior
5. Document/history/dirty-state handling
6. Character workspace registration
7. Manifest and package export integration
8. Files and APIs changed
9. Automated tests
10. Manual verification
11. Exact command results
12. Remaining limitations

Do not claim completion unless all required commands pass.
