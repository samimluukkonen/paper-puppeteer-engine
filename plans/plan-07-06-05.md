# Paper Puppeteer Engine — v0.7.6.5
## Animation Editor Guided Tutorials

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.7.6.4**

Tech stack: React, TypeScript (strict), Phaser, Vite, npm.

The Feature Guide Wizard supports selectable tutorials, spotlight highlighting and step-by-step navigation.

Rig Editor guides are implemented.

## Goal

Add accurate and practical guided tutorials for the Animation Editor.

The artist should be able to learn the editor's animation tools without reading extensive documentation or asking the developer where features are located.

## 1. Inspect actual implementation

Review the current Animation Editor controls and their locations.

Features may include:
- New Animation creation
- Bone hierarchy and preview
- Timeline
- Playback controls
- Property inspector
- Keyframe creation and manipulation
- Interpolation
- Animation events
- Onion skinning
- Mirroring
- IK target animation
- IK baking
- Rig-Tweak mode
- Animation export

Register only features that actually exist.

## 2. Guide catalog

Create individual selectable guides for these workflows when supported:

### A. Create a new animation
Create an animation without an existing animation JSON.

### B. Create your first keyframe
Select a bone, position the playhead and create a transform key.

### C. Animate a bone
Create multiple keyframes and preview movement.

### D. Timeline navigation
Explain playback, scrubbing, zooming and track navigation.

### E. Keyframe editing
Move, select, duplicate, copy/paste and delete keys.

### F. Interpolation
Explain stepped and smooth motion.

### G. Onion skinning
Explain previous/next ghost poses and settings.

### H. Mirrored animation
Explain bone pairs, preview and mirror commit.

### I. IK target animation
Explain creating position keys and dragging the target.

### J. IK baking
Explain when to convert IK motion to bone keyframes.

### K. Animation events
Explain event markers, payloads and timing.

### L. Rig-Tweak mode
Explain structural rig changes versus animation keys.

### M. Exporting animations
Show validation, JSON export and character package integration.

Do not implement new animation functionality in this milestone.

## 3. Short, task-oriented steps

Each guide should focus on one actual task.

Aim for 3–7 steps per guide.

Example: "Create Your First Animation"

```text
1. New Animation
Click New Animation to begin.

2. Animation Settings
Choose a name, duration and FPS.

3. Select Bone
Choose the bone to animate.

4. Timeline
Move the playhead to your first keyframe.

5. Create Key
Set the bone transform key.

6. Preview
Move the playhead and play the animation.

7. Export
Export the authored animation JSON.
```

Use real UI names and actual current behavior.

## 4. Highlight anchors

Add stable anchors for:
- New Animation
- Animation selection
- Playback controls
- Timeline ruler
- Bone tracks
- Keyframe editing controls
- Interpolation controls
- IK inspector
- Onion skinning
- Mirror panel
- Event tools
- Export

Do not highlight arbitrary DOM positions.

For canvas-specific operations, use the Phaser/editor target geometry provider or spotlight the preview region with accurate guidance.

## 5. Working with existing animation data

Tours must work with arbitrary character rigs.

Do not assume bones are named leftArm, shoulder or hand.

If a guide requires IK constraints or existing keyframes, detect that prerequisite and explain it.

Do not silently add sample animation data.

## 6. Non-destructive tour navigation

Reading a guide and advancing steps must not:
- Create keys
- Modify IK
- Bake animations
- Mirror keys
- Delete events
- Change animation data
- Create Undo entries
- Mark animation dirty

Actual artist-triggered operations are allowed only through normal editor controls.

## 7. UI synchronization

Ensure spotlight targets remain correct when:
- Timeline is zoomed
- Timeline scrolls
- Tracks expand
- Inspector panels change
- Animation selection changes
- React layout changes
- Phaser preview moves

Use the existing v0.7.6.3 target resolution infrastructure.

## 8. Tests

Cover:
- Registration and correct categories
- Target availability
- Empty animation
- Existing animation
- Optional IK features
- Timeline layout changes
- Navigation/exit
- No accidental animation edits
- React component cleanup

## 9. Manual verification

Run each guide against a representative character.

Check that:
- Instructions are accurate
- Relevant controls are visible
- No spotlight points to the wrong place
- Tooltip does not block essential controls
- Exit works
- Existing animation data is preserved

## 10. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

The Animation Editor has an organized library of tutorials covering the implemented authoring features, with accurate spotlight targets and straightforward instructions.

## Final report

Provide guide catalog, target anchors, prerequisites, tests, manual verification, limitations and exact command results.
