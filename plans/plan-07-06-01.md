# Paper Puppeteer Engine — v0.7.6.1
## Interactive Guide Architecture

Continue developing my Paper Puppeteer Engine project.

**Current completed version: v0.7.5.**

Technology stack:
- React + TypeScript (strict)
- Phaser for rendering
- Vite, npm, ES modules

This is a private application for myself and one artist friend. Keep the solution simple, maintainable and practical.

Do not add a third-party product-tour framework unless there is a compelling reason.

## Goal

Establish the architecture for an interactive Feature Guide Wizard covering the Rig Editor and Animation Editor.

The artist will eventually select a feature and receive step-by-step explanations with the relevant editor controls highlighted.

This phase implements only the guide model, registry, targeting contract and state management. Do not build the modal or spotlight yet.

### 1. Inspect existing architecture

Examine:
- React application structure
- Editor navigation
- Rig Editor components
- Animation Editor components
- Shared toolbar/navigation components
- Modal/dialog conventions
- React/Phaser integration
- Current help or documentation UI

Use existing component and state-management patterns.

### 2. Guide data model

Create strongly typed definitions.

Conceptual example:

```ts
interface GuideDefinition {
  id: string;
  title: string;
  description: string;
  editor: "rig" | "animation";
  steps: GuideStep[];
}

interface GuideStep {
  id: string;
  title: string;
  description: string;
  targetId: string;
}
```

Extend only where justified.

Include support for:
- Guide identification
- Feature category
- Short feature description
- Ordered steps
- Highlight target
- Optional prerequisites
- Optional safe UI preparation
- Availability checking

Guide definitions are frontend data, not animation or rig data.

### 3. Central guide registry

Create a typed registry for available guides.

Conceptually:

```ts
getAllGuides()
getGuidesForEditor("rig")
getGuideById("rig-joint-editing")
```

Avoid scattered guide definitions inside React component markup.

Guides should be easy to add later.

### 4. Stable highlight anchors

Establish stable identifiers for editor controls.

Prefer explicit attributes such as:

```tsx
data-guide-id="rig-bone-hierarchy"
```

over fragile selectors based on CSS class names or DOM position.

Do not require every UI component to be rewritten.

Add anchors incrementally as guides are implemented.

### 5. Phaser canvas targets

Some editor features exist visually inside Phaser rather than in DOM elements.

Design a target-resolution interface supporting:
- DOM element rectangles
- Editor panel rectangles
- Optional geometry supplied by Phaser/editor controllers

Do not attempt to inspect arbitrary Phaser GameObjects through DOM selectors.

Use one common rectangle representation for future spotlight rendering.

### 6. Guide state

Implement a lightweight React-compatible guide controller or hook supporting:
- Start guide
- Current guide
- Current step
- Next
- Previous
- Exit
- Finish
- Availability/status

Prevent out-of-range navigation and duplicate active guides.

### 7. Non-destructive behavior

Tour navigation must not:
- Modify rig data
- Modify animation keyframes
- Mark character documents dirty
- Create Undo history
- Dispatch animation events
- Trigger gameplay behavior

Preparing a step may reveal a panel or tab, but it must not silently change authored data.

### 8. Tests

Cover:
- Registry lookup
- Guide IDs
- Step ordering
- Navigation boundaries
- Start/exit/finish
- Missing guide
- Missing step
- Availability checks
- State reset
- Authored data isolation

### 9. Out of scope

Do not implement:
- Guide selection modal
- Spotlight overlay
- Tooltip UI
- Full tutorial content
- Automatic user-action execution
- User accounts
- Cloud guide progress tracking
- Analytics

### 10. Verification

Run and fix all failures:

```bash
npm run typecheck
npm run test
npm run build
```

## Definition of done

A reusable, strongly typed guide registry and controller exist, supporting the Rig Editor and Animation Editor without changing their authored data or runtime behavior.

## Final report

Provide implemented APIs, architecture, files changed, tests, command results and deferred features. Do not claim completion unless checks pass.
