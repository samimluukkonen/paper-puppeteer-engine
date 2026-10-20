# Paper Puppeteer Engine — v0.7.6.3
## Spotlight Overlay & Guided Steps

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.7.6.2**

Tech stack: React, TypeScript (strict), Phaser, Vite, npm.

Existing guide infrastructure:
- Typed guide registry
- Guide controller
- Stable target IDs
- Feature selection modal
- Editor navigation

## Goal

Create the visual guided-tour experience.

When a step is active, the editor background should be dimmed except for a clearly highlighted UI element. A floating explanation should appear near the highlighted area.

### 1. Spotlight overlay

Render a full-screen overlay above the editor.

Requirements:
- Dark translucent background
- Clear rectangular spotlight cutout
- Optional rounded corners
- Visible highlight border
- Correct stacking above React and Phaser canvas
- No changes to actual editor styling

Use a React portal where appropriate.

Use CSS/SVG or another lightweight implementation. Avoid unnecessary dependencies.

### 2. Target resolution

Resolve each step's stable target ID to an on-screen rectangle.

Support targets backed by:
- DOM elements
- Whole editor panels
- Registered Phaser/editor geometry providers

Do not assume Phaser canvas objects exist in the DOM.

### 3. Dynamic positioning

Keep the spotlight aligned when:
- Window resizes
- Panels resize
- Sidebars expand/collapse
- Editor scrolls
- Browser zoom changes
- Phaser viewport changes

Use appropriate observers and existing app layout hooks.

Clean up listeners on step transitions and unmount.

### 4. Automatic reveal

If the target is inside a collapsed panel or scrollable container, use safe UI preparation to reveal it.

Examples:
- Expand the appropriate inspector
- Switch to the necessary tab
- Scroll the target into view

Do not automatically change authored rig or animation data.

### 5. Explanation card

Display a positioned instructional card:

```text
EDITING JOINTS

Step 2 of 5

Select the bone you want to edit
from the hierarchy.

[Back] [Next] [Exit]
```

Include:
- Guide title
- Current step
- Explanation
- Back
- Next / Finish
- Exit

Place the card near the spotlight without obscuring the target where possible.

Flip or reposition near viewport edges.

### 6. Navigation

Support:
- Next
- Back
- Exit
- Finish
- Escape to exit

The user must always be able to quit immediately.

Do not trap them inside a tutorial.

### 7. Pointer interaction

Implement an explicit policy.

For the initial milestone:
- Guide navigation must work reliably.
- The rest of the editor should not receive accidental clicks.
- Highlighted controls may remain interactive if safe and technically supported.

If click-through interaction is not yet safe, use explanation-only steps and defer guided practice to v0.7.6.6.

Never make the highlighted area appear clickable if interaction is intentionally blocked without explaining it.

### 8. Focus and accessibility

Provide sensible keyboard focus for the guide card.

Use semantic labels and readable contrast.

For interactive spotlight steps, permit focus on the highlighted control without making the rest of the editor accidentally interactive.

Restore focus appropriately when exiting.

### 9. Missing targets

If a target disappears:
- Attempt the registered safe reveal operation
- Re-resolve the target
- If still missing, show a clear fallback with Skip/Exit

Do not leave an invisible spotlight or crash.

### 10. Animation

Use subtle CSS transitions for spotlight and explanation movement.

Avoid distracting effects.

Respect reduced-motion preferences.

### 11. Tests

Cover:
- Overlay positioning
- Missing targets
- Resize/scroll
- Tooltip placement
- Navigation
- Escape
- Cleanup
- Guide finish
- Non-destructive operation
- Accessibility behavior

### 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

A guide can highlight an actual editor control with a dimmed background, display a step explanation, advance backward/forward, and close safely.

## Final report

Provide spotlight implementation, target positioning, navigation behavior, accessibility, resource cleanup, tests and exact command results.
