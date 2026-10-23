# Paper Puppeteer Engine — v0.9.8.3
## Animation & Scene Ground Integration

Continue developing Paper Puppeteer Engine.

Current completed version: **v0.9.8.2**.

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Already implemented:
- Ground reference guides (v0.9.7)
- Bone-local foot contact markers
- Visual marker authoring in Rig Editor
- Animated IK targets
- Actor placement and scene choreography
- Animation and scene playback/scrubbing

Do not rebuild any of these systems.

## Goal

Integrate foot contact markers with ground alignment in Animation Editor and Scene Editor.

The marker's evaluated world position should become the authoritative reference for explicit foot/Actor grounding operations.

## Part A — Animation Editor

### 1. Display foot contact markers

Optionally show all rig-defined foot contact markers in Animation Editor.

Markers must follow evaluated bone transforms after FK and IK.

They must update during:
- Playback
- Scrubbing
- Mirroring
- IK target animation
- Root motion where supported

The existing ground line must remain stationary in its documented reference coordinate system.

### 2. Contact distance

For each visible marker, calculate the vertical distance to the ground reference.

Conceptually:

```ts
distanceToGround =
  markerGroundSpaceY - groundY;
```

Convert to the same coordinate space before subtracting.

Document the sign convention using the project's actual Y-axis orientation.

Consider optional visual feedback:
- On ground
- Above ground
- Below ground

Use a small configurable tolerance rather than relying on exact floating-point equality.

This is diagnostic information, not automatic collision handling.

### 3. Explicit IK alignment

Offer an action:

**Align Selected Foot Contact to Ground**

The workflow should be:

1. Artist selects a foot contact marker.
2. Artist selects or confirms the applicable existing foot IK constraint.
3. Engine evaluates the current pose and marker position.
4. Engine calculates the necessary correction in the IK target's coordinate system.
5. Artist previews the corrected pose.
6. Artist explicitly applies the change as IK target key data using the existing authoring system.

Important:
- Contact position and IK target position are different.
- Do not blindly set IK target Y to ground Y.
- Use the post-IK evaluated marker position to verify the result.
- Respect existing chain reach limits and target spaces.
- If exact alignment cannot be achieved, show the residual error and do not claim success.
- Preserve the original pose until the user commits.

Reuse the existing IK solver and animation-key authoring API.

If a marker has no associated usable IK constraint, explain that alignment requires manual posing or an IK setup. Do not fabricate a constraint.

### 4. No automatic key creation

Merely displaying the markers, scrubbing or changing the ground line must never author keyframes.

Only explicit alignment commits may change IK target keys.

Integrate with existing Undo/Redo.

### 5. Foot contact selection

Support choosing which marker to align.

Do not always use the left foot, right foot or lowest point.

Non-humanoid rigs may contain additional markers.

## Part B — Scene Editor

### 6. Display markers when useful

Show foot contact markers on the selected Actor where appropriate.

Do not clutter the entire scene by permanently showing every marker for every Actor.

### 7. Snap Actor to ground

Upgrade the existing v0.9.7 Scene Editor grounding operation.

The artist selects an Actor and an available foot contact marker.

Calculate the marker's actual scene-world position using:
- Current evaluated Actor/Puppet pose
- Rig and bone transforms
- Facing
- Actor scale
- Actor world position

Determine the Actor translation required to align that marker with the scene ground.

For a horizontal ground guide, preserve Actor X and apply only the required world-Y translation.

Do not simply set Actor position Y equal to ground Y.

### 8. Multiple feet and pose differences

Two foot contact markers may be at different heights during a walk animation.

Use the explicitly selected marker to determine grounding.

Optionally offer a documented supporting-foot choice, but do not automatically move bones to force both feet onto the ground.

### 9. Authoring versus runtime

Snapping an Actor in Scene Editor should update its authored initial transform only when explicitly committed.

The action must not:
- Modify the character rig
- Modify animation keys
- Change existing scene movement paths
- Enable physics
- Automatically constrain Actors during playback

Existing Actor choreography remains authoritative.

### 10. Reuse existing fallback

Some older characters may not have foot contact markers.

Preserve the current v0.9.7 fallback behavior, clearly labeled when it only aligns the Actor origin or user-defined contact offset.

Do not silently invent a precise foot contact point.

### 11. Tests

Cover:
- Marker position during animation
- FK and IK evaluation
- Ground distance calculation
- Coordinate conversion
- IK alignment success
- Unreachable IK targets
- No IK constraint
- Undo/Redo
- Scene Actor grounding
- Scale and facing
- Multiple markers
- Scene playback/scrubbing
- Authored data isolation
- Existing rigs without markers

### 12. Manual verification

**Animation Editor:**
1. Load a walking animation.
2. Show contact markers and ground.
3. Select one foot contact marker.
4. Scrub to a contact pose.
5. Preview IK alignment.
6. Commit an IK target correction.
7. Verify marker reaches the ground within supported tolerance.
8. Undo/Redo.

**Scene Editor:**
1. Add two differently sized characters.
2. Enable ground reference.
3. Select an Actor and its foot marker.
4. Snap the Actor to ground.
5. Repeat with the second Actor.
6. Preview and scrub choreography.
7. Verify no animation keys changed.

### 13. Out of scope

Do not implement:
- Automatic foot locking
- Foot sliding correction
- Automatic gait phase detection
- Ground collision
- Gravity
- Physics
- Terrain slopes

### 14. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

The Animation Editor can use a foot contact marker for deliberate IK alignment, and Scene Editor can position Actors using actual evaluated foot contact points.

Both workflows are opt-in and preserve existing character and animation data unless a normal explicit edit is committed.

## Final report

Provide the transform calculations, alignment semantics, IK behavior, Scene Editor integration, failures/limitations, files changed, tests and exact results.
