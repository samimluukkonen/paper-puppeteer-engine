# Paper Puppeteer Engine — v0.7.6.2
## React Feature Selection Modal

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.7.6.1**

Tech stack: React, TypeScript (strict), Phaser, Vite, npm.

The project now has a typed guide registry and guide state controller.

Do not rebuild these systems.

## Goal

Implement the Feature Guide selection interface.

The user should be able to open one modal, choose which editor feature they want to learn, and launch that guide.

### 1. Entry point

Add a clear toolbar/navigation button:

**Feature Guide**

Use an appropriate help/graduation-cap icon.

It should be accessible from:
- Rig Editor
- Animation Editor
- Main character workspace, if supported

Use the existing React application layout.

### 2. Feature selection modal

Create a React modal resembling:

```text
FEATURE GUIDE

What would you like to learn?

[ Rig Editor ] [ Animation Editor ]

RIG EDITOR

Creating a character
  Build a new character from scratch
  [Start Guide]

Editing joints
  Position bones and joint pivots
  [Start Guide]

Importing sprites
  Bring your artwork into the editor
  [Start Guide]

Adding IK
  Configure inverse kinematics
  [Start Guide]

[Close]
```

Guide entries must come from the registry.

Do not hardcode the actual guide catalog twice.

### 3. Categories

Support at least:
- Rig Editor
- Animation Editor

Use compact feature cards or grouped rows.

Each entry should show:
- Feature title
- Brief description
- Availability
- Start action

Use existing styling and components.

### 4. Feature availability

A guide may require:
- A character to be loaded
- A valid rig
- An animation
- Specific IK constraints
- Particular UI tools

Show unavailable guides with a reason.

Do not silently launch tutorials that cannot work in the current context.

If a guide can teach the user to create the missing prerequisite, make that guide available.

### 5. Editor navigation

If the user selects a Rig Editor guide while in Animation Editor, the application should navigate to Rig Editor using existing navigation mechanisms.

Likewise for Animation Editor guides.

Respect existing unsaved-change protection.

Never discard unsaved work to start a tutorial.

### 6. Guide launch

When Start Guide is clicked:
- Validate availability
- Select guide
- Navigate to the correct editor if necessary
- Close the selection modal
- Activate the first step

Do not implement spotlight rendering yet. That comes in v0.7.6.3.

### 7. React modal accessibility

Support:
- Keyboard focus
- Escape to close
- Focus restoration
- Accessible labels
- Keyboard navigation

Reuse existing dialog components if possible.

### 8. Empty states

Handle:
- No character
- No guides in category
- Missing optional feature
- Invalid guide reference

Avoid crashes and misleading enabled buttons.

### 9. Tests

Cover:
- Opening/closing
- Category switching
- Guide registry integration
- Selecting a guide
- Availability
- Launch behavior
- Navigation guards
- Keyboard/focus behavior

### 10. Out of scope

Do not implement:
- Spotlight effect
- Step instruction cards
- Tour content for every feature
- Progress database
- Remote tutorials
- User accounts

### 11. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

The user can open Feature Guide, browse available Rig Editor and Animation Editor tutorials, and select a guide using a clean React modal.

## Final report

Provide implemented components, navigation handling, registry integration, tests, files changed and command results.
