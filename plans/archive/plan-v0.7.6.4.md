# Paper Puppeteer Engine — v0.7.6.4
## Rig Editor Guided Tutorials

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.7.6.3**

Tech stack: React, TypeScript (strict), Phaser, Vite, npm.

The Feature Guide Wizard now supports selecting tutorials and highlighting editor controls with a spotlight.

## Goal

Create practical, accurate, step-by-step guided tours for the Rig Editor.

The artist should be able to learn how to perform common rigging and artwork tasks directly in the actual UI.

## 1. Inspect the real Rig Editor

Before writing tutorial steps, inspect:
- Actual React components
- Actual controls and labels
- Bone hierarchy
- Joint manipulation
- Sprite artwork import
- Artwork alignment
- Slots and attachments
- Skin editor
- IK constraint tools, if implemented
- Rig export workflow

Do NOT invent controls that do not exist.

Only register tours for implemented features.

## 2. Initial Rig Editor guide catalog

Implement guides for available features:

### A. Creating a new character
Explain the New Character workflow if implemented.

### B. Creating bones
Show the bone hierarchy and Add Bone operation.

### C. Editing joint positions
Explain how to select a bone and move its joint.

### D. Importing artwork
Introduce the sprite import and image selection tools.

### E. Aligning sprites
Explain sprite origins, offsets and how they relate to joints.

### F. Slots and attachments
Show how artwork is associated with a bone.

### G. Creating/changing skins
Explain alternate appearances and skin assignments.

### H. IK constraints
Explain creating/selecting IK chains and dragging their default targets, if the feature is implemented.

### I. Exporting the rig or character
Introduce validation and export actions.

Start with these guides; don't add fictional functionality.

## 3. Each guide must be task-focused

Prefer approximately 3–7 meaningful steps per guide.

For example, "Editing Joint Positions":

```text
Step 1: Bone Hierarchy
Choose the bone you want to modify.

Step 2: Joint Editing Tool
Enable the joint manipulation mode.

Step 3: Character Preview
Drag the joint marker to its new location.

Step 4: Rig Inspector
Use numeric coordinates for precision.

Step 5: Undo/Redo
Review or undo the change.

Step 6: Save/Export
Save the modified rig.
```

Use actual controls and actual implementation behavior.

## 4. Stable target anchors

Assign `data-guide-id` or existing equivalent stable anchors to relevant React controls.

For Phaser interactions, highlight:
- The preview canvas/panel
- Appropriate tool controls
- Registered joint/handle geometry where available

Do not force fragile DOM selectors into Phaser rendering.

## 5. Safe preparation

A guide may:
- Select a UI tab
- Reveal a panel
- Scroll to controls
- Highlight a tool

It must not automatically:
- Create bones
- Delete bones
- Change joints
- Replace sprites
- Save/export data

The user remains responsible for authored actions.

## 6. Prerequisites

If a guide needs a loaded character, show that requirement.

If it requires a specific existing bone or IK constraint, do not hardcode a demo character.

Guide the user toward prerequisite creation or give a clear unavailable state.

The wizard should work on newly created characters and existing characters.

## 7. Terminology

Maintain clear explanations:

- Bone/joint = skeleton structure
- Sprite origin = artwork pivot
- Sprite offset = artwork position relative to bone
- Slot = attachment location
- Skin = appearance mapping
- Rig IK target = default rig constraint target

Keep descriptions short and artist-friendly.

## 8. Tests

Cover:
- Guide registration
- All step targets resolve
- Conditional feature availability
- Empty rigs
- Existing rigs
- Panel reveal
- Guide navigation
- React/Phaser target resolution
- No automatic authored changes

## 9. Manual verification

Walk through each available Rig Editor guide.

Confirm:
- Every spotlight points to the intended control
- Every explanation matches actual behavior
- The target is visible
- No unnecessary scrolling
- The guide can be exited at any step
- Unsaved rig edits remain protected

## 10. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

The Rig Editor has useful selectable tutorials that accurately show artists where and how to use its existing features.

## Final report

Provide implemented guide catalog, step counts, anchors added, unavailable features, tests, manual verification and exact command results.
