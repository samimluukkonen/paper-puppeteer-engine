# Paper Puppeteer Engine — v0.7.6.6
## Interactive Guidance & Production Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.7.6.5**

Tech stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

The Feature Guide Wizard now includes:
- Guide registry
- Feature selection modal
- Spotlight overlay
- Step explanations and navigation
- Rig Editor guides
- Animation Editor guides

This milestone completes v0.7.6.

The application is intended for myself and one artist friend. Keep the implementation practical, not enterprise-scale.

## Goal

Polish the guide into a reliable, intuitive learning experience that helps the artist actually use the editor.

Focus on:
1. Optional interactive practice
2. Spotlight interaction safety
3. Missing-target recovery
4. Navigation and accessibility
5. Guide accuracy
6. React/Phaser lifecycle
7. Documentation and regression testing

## 1. Interactive guided practice

Allow supported steps to optionally let the artist interact with the highlighted real control.

For example:

```text
CREATING KEYFRAMES

Step 3 of 5

Click the Set Key button to create
a keyframe at the current time.

[Back] [Next] [Exit]
```

The user should be able to click the actual highlighted button if the step is marked interactive.

Do not simulate a click automatically.

### 2. Interaction modes

Support two clear step behaviors:

**Explain**
- Highlights a feature.
- Explains its purpose.
- Navigation uses Next/Back.

**Try It**
- Highlights the relevant real control.
- Allows the artist to perform the normal editor action.
- Optionally recognizes successful completion.

Use a typed step configuration.

Do not require every step to be interactive.

### 3. Safe spotlight interaction

During interactive steps:
- Permit interaction with the intended highlighted target.
- Prevent accidental clicks on unrelated dimmed controls.
- Keep Exit/Back/Next available.
- Preserve keyboard accessibility.
- Do not bypass normal editor validation.

For complex Phaser canvas interactions, use existing editor pointer/input mechanisms and the guide geometry provider.

Do not create separate editing handlers for guides.

### 4. Completion detection

Where the editor exposes reliable state events, allow a step to recognize completion.

Examples:
- Selected a bone
- Opened a panel
- Created a keyframe
- Enabled onion skinning

Observe authoritative editor state or events.

Do not infer successful authored changes merely from a generic pointer click.

Automatic advancement should be optional and should never skip important explanation unexpectedly.

Always allow manual Next/Skip for nonessential steps.

### 5. No hidden mutations

The guide itself must not:
- Write rig definitions
- Write animation keys
- Invoke IK baking
- Replace sprites
- Apply mirroring
- Delete authored data

If an artist intentionally performs an editing operation during Try It, that normal editor action should use standard validation, dirty state and Undo/Redo.

Explain clearly when a practice action changes their real project.

Do not silently construct or replace demo data.

### 6. Prerequisite recovery

When a selected guide cannot run:
- Explain what is missing.
- Offer the relevant prerequisite guide if available.
- Allow exiting or returning to the guide catalog.

Examples:
- No character loaded
- No animation selected
- No IK constraint
- No bone selected

Do not launch a broken tour.

### 7. Missing or moving targets

Handle targets that:
- Become hidden
- Are removed by a rerender
- Move during resizing
- Change when selecting another character
- Become unavailable after state changes

Re-resolve targets and clean up observers.

Show a useful fallback instead of leaving a stranded overlay.

### 8. Guide restart

Provide a convenient way to:
- Exit a guide
- Restart the current guide
- Return to feature selection
- Start another guide

Do not require refreshing the page.

### 9. Optional local progress

If easy using existing app preferences, store a simple local completed-guide indicator.

Example:

```text
Editing Joints       ✓ Completed
Importing Sprites    Not started
IK Animation         ✓ Completed
```

This is optional.

Do not introduce:
- Authentication
- Database tables
- Cloud sync
- User analytics
- Progress accounts

### 10. Accessibility

Audit:
- Escape
- Back/Next/Finish
- Focus handling
- Tooltip readability
- Spotlight contrast
- Reduced-motion behavior
- Keyboard-only navigation
- Screen-reader labels
- Scroll/viewport constraints

Interactive controls must not become impossible to focus.

### 11. React/Phaser lifecycle

Stress-test:
- Starting/exiting repeatedly
- Switching guides
- Switching editors
- Changing characters
- Changing animations
- Opening/closing panels
- Scene resize
- React unmount
- Phaser scene destruction

No leaked event listeners, observers or overlay objects.

### 12. Full guide review

Review all guides against the actual current implementation.

Confirm:
- Feature title is correct
- Every step describes a real action
- Anchor exists
- Highlight points to the right element
- Explanation matches functionality
- Prerequisites are accurate
- No tutorial assumes a specific demo character
- No authored changes occur from navigation alone

Remove or clearly disable inaccurate guides rather than shipping misleading instructions.

### 13. Regression checks

Ensure Guide Wizard does not interfere with:

**Rig Editor**
- Bone/joint editing
- Sprite alignment
- Slot assignment
- Skin management
- IK target editing
- Undo/Redo
- Export

**Animation Editor**
- Timeline
- Keyframe authoring
- Playback
- IK animation
- IK baking
- Onion skinning
- Mirroring
- Events
- Import/export

**Runtime**
- Puppet playback
- CharacterLoader
- IK
- Animation events
- v0.7 playback controller

The guide must not become a dependency of the production Puppet runtime.

### 14. Documentation

Add a short artist-facing guide explaining:
- Opening Feature Guide
- Selecting an editor category
- Starting a tutorial
- Spotlight meanings
- Back/Next/Exit
- Try It behavior
- Restarting guides
- Missing prerequisites

Keep documentation concise.

### 15. Tests

Expand automated coverage for:
- Interactive spotlight targets
- Completion detection
- Non-destructive navigation
- Intentional edit handling
- Undo/Redo integration
- Missing prerequisites
- Unavailable controls
- Resize/scroll
- Exit/restart
- Focus and accessibility
- Resource cleanup

Use existing React and browser testing tools.

Do not claim a browser interaction was manually verified unless it was actually exercised.

### 16. Out of scope

Do not implement:
- Online tutorial hosting
- Multi-user accounts
- Cloud analytics
- AI-generated tutorials
- Screen recording
- Collaboration features
- Remote guide management
- New animation/rigging features

### 17. Verification

Run and fix all failures:

```bash
npm run typecheck
npm run test
npm run build
```

Also run available lint, React component and browser/E2E tests.

## Final v0.7.6 definition of done

The Feature Guide Wizard is complete when:

- The user can open a feature-selection modal.
- Rig Editor and Animation Editor categories are available.
- Guides describe actual implemented features.
- The user can launch a selected guide.
- The background becomes dimmed.
- The relevant UI control is spotlighted.
- An explanation appears near the target.
- Back, Next, Finish and Exit work.
- Guides handle scroll, resize and changing panels.
- Optional guided practice uses real editor controls safely.
- Tour navigation never changes authored data.
- Prerequisites are handled.
- Missing targets do not crash.
- React/Phaser lifecycle is safe.
- Existing editor features remain functional.
- Tests, typecheck and build pass.

## Final report

Provide:
1. Final Guide Wizard architecture
2. Feature selection experience
3. Spotlight and tooltip implementation
4. Interactive practice behavior
5. Rig Editor guides
6. Animation Editor guides
7. Supported prerequisites
8. React/Phaser lifecycle
9. Files/APIs changed
10. Automated tests
11. Manual verification
12. Documentation updates
13. Exact command results
14. Remaining limitations

Do not claim completion unless required checks pass.
