# Paper Puppeteer Engine — v1.5.3.2
## Visual Animation Retargeting Editor

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.5.3.1**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing systems:
- Animation Library
- Rig compatibility analysis
- Bone Mapping Editor
- Animation retargeting service
- Animation playback/evaluation
- Root motion
- Ground and foot contact tools
- Animation Editor and Undo/Redo

## Goal

Provide a visual, artist-friendly workflow for retargeting an existing animation to a different character.

The artist must be able to compare the original and target animations before accepting the result.

No manual JSON editing should be required.

## 1. Inspect existing UI

Review:
- Animation Library
- Character selection
- Rig comparison
- Animation preview
- Phaser renderer
- Working-copy lifecycle
- Modal/panel conventions
- Animation creation/registration
- Export/import

Reuse these systems.

## 2. Retarget Animation action

Add an action to Animation Library:

**Retarget to Another Character**

Open a guided workflow that lets the artist select:
1. Source animation
2. Target character
3. Bone mapping
4. Retargeting options
5. Preview
6. Save resulting animation

## 3. UI layout

Conceptual interface:

RETARGET ANIMATION

Source Character: Samurai A
Target Character: Samurai B

Source Animation:
[ Sword Cut Forward ]

Bone Mapping:
[ Samurai A → Samurai B ]

Compatibility:
[ Mappable — warnings available ]

Options:
[ Root Motion: Scale to Character ]
[ IK: FK-only Transfer ]

[Preview Result] [Create Animation]

Use actual UI components and supported options.

Do not claim a mapping is valid unless validation succeeds.

## 4. Side-by-side preview

Show:
- Source animation on source character
- Retargeted animation on target character

Both should:
- Use one synchronized preview time
- Support play/pause
- Support scrubbing
- Support playback speed
- Respect FK/IK evaluation
- Display root motion where applicable
- Render rigid and mesh attachments correctly

Prefer reusing existing Phaser preview components.

Do not build a second animation evaluator.

## 5. Ground alignment

If ground reference and foot contact markers exist, support displaying them in the comparison.

This can help identify:
- Incorrect step length
- Foot floating
- Foot sliding
- Incorrect pelvis height
- Unexpected limb proportions

These observations are diagnostics, not automatic corrections.

Do not implement automatic foot locking.

## 6. Mapping adjustments

Allow returning to the Bone Mapping Editor to correct mismatched bones.

After changing the mapping, regenerate the preview result from the unchanged source animation.

Do not repeatedly retarget an already-retargeted temporary result, because errors could accumulate.

## 7. Retargeting options

Expose only options genuinely supported by v1.5.3.1, including appropriate:
- Root-motion policy
- IK transfer policy
- Handling for missing tracks
- Translation scaling strategy

Provide tooltips or brief explanations.

Do not show controls that don't affect the result.

## 8. Diagnostics

Show actionable warnings:
- Bone missing
- Ambiguous mapping
- Different rest-pose orientation
- Missing IK chain
- Unmapped IK target
- Mesh deformation corrections omitted
- Unsupported track type
- Large proportion mismatch

Do not silently discard important animation data.

## 9. Save resulting animation

When the artist accepts:
- Generate a unique animation ID.
- Register it for the target character.
- Store a new animation document.
- Preserve the original animation.
- Open the new animation in Animation Editor.
- Allow normal keyframe editing.

If creation fails, do not leave a partially registered asset.

## 10. Preview isolation

Previewing must not:
- Mutate source animation
- Modify target rig
- Create ordinary animation keyframes
- Change existing Scene Editor Actors
- Mark source assets dirty

Cancel must discard temporary data.

## 11. Undo/Redo and recovery

Use existing asset creation/history semantics.

Ensure the newly committed animation is recoverable through project autosave.

The retargeted result must survive export/import.

## 12. Tests

Cover:
- Open workflow
- Target selection
- Mapping selection
- Preview synchronization
- Option changes
- Cancel
- Compatibility warnings
- Missing/invalid bones
- IK and root motion
- Mesh correction warnings
- New animation creation
- Source isolation
- Project export/import
- Phaser resource cleanup

## 13. Manual acceptance

1. Create two samurai characters with different proportions.
2. Give them compatible bone structures.
3. Open a sword-cut animation on Samurai A.
4. Retarget it to Samurai B.
5. Review bone mapping.
6. Preview both characters simultaneously.
7. Adjust options.
8. Observe foot positions and root displacement.
9. Save a new animation for Samurai B.
10. Open it in Animation Editor.
11. Make a manual correction.
12. Verify Samurai A's source is unchanged.
13. Export/reload.

## 14. Out of scope

Do not implement:
- Automatic character rigging
- AI-based motion transfer
- Complex mesh retargeting
- Live-linked inherited animations
- Physics correction
- Advanced motion matching

## 15. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

An artist can visually retarget, inspect and save a compatible animation on another character through the React interface, with clear diagnostics and no changes to the source.

## Final report

Describe retargeting workflow, comparison preview, mapping behavior, asset creation, source isolation, files changed, tests and exact results.
