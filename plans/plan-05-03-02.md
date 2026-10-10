# Paper Puppeteer Engine — v0.5.3.2
## Ghost Pose Rendering

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.3.1**

The engine now supports read-only ghost pose sampling at neighboring animation times.

Do not rewrite the sampling system or existing animation evaluator.

Tech stack: TypeScript, Phaser, Vite, npm, strict TypeScript, ES modules, React.

## Goal

Implement visible ghost poses in the Animation Editor.

Initially display:
- One previous pose
- One next pose
- The current puppet normally

All ghosts must be editor-only visualization objects.

### 1. Ghost rendering architecture

Introduce a dedicated editor-only ghost rendering component/layer.

Conceptually:

```text
Animation Editor
├── Ghost Pose Sampling
├── Ghost Rendering Layer
│   ├── Previous Ghost
│   └── Next Ghost
└── Active Puppet Preview
```

Reuse the existing Phaser rendering and attachment infrastructure wherever practical.

Do not implement a second independent character-rendering engine.

### 2. Visual appearance

Display:
- Previous ghost: translucent cool tint
- Next ghost: translucent warm tint
- Current puppet: normal colors and full opacity

Choose reasonable defaults.

Ghosts must be distinguishable from the active puppet without obscuring it.

Prefer rendering ghosts behind the active puppet.

### 3. Correct transforms

Ghosts must preserve the sampled pose's:
- Bone transforms
- Joint hierarchy
- Local-to-world transformation
- Puppet position
- Scale
- Facing
- Sprite pivot/origin
- Sprite offset
- Attachment transforms
- Render ordering

The ghost should show where the character actually was or will be at the sampled time.

Do not simply duplicate sprites without applying the correct sampled transforms.

### 4. Artwork and skins

Ghosts must use the same currently selected character artwork as the active puppet.

Respect:
- Slots
- Attachments
- Skin selection
- Sprite frame selection
- Attachment visibility
- Render depth

Switching skins should update ghost appearances without rebuilding the rig.

Do not store duplicate asset images in animation JSON.

### 5. Rendering implementation

Prefer lightweight render-only ghost instances or a reusable ghost layer.

Avoid creating fully active Puppet instances with independent animation clocks or event systems.

If Puppet instances must be reused, ensure they cannot:
- Advance animation independently
- Dispatch events
- Execute gameplay behavior
- Mutate animation data
- Intercept editor pointer interactions

Reuse loaded textures.

Avoid rebuilding all GameObjects unnecessarily every frame.

### 6. Minimal visibility control

Add a basic Animation Editor toggle:

```text
[ ] Onion Skinning
```

When enabled:
- Previous ghost appears when a valid sample exists
- Next ghost appears when a valid sample exists

When disabled:
- Ghost visualization is hidden
- The editor returns to its ordinary appearance

The toggle is transient editor state.

It must not mark animation dirty or be serialized.

### 7. Synchronization

Ghosts must update when:
- Current time changes
- User scrubs
- Animation selection changes
- Working animation keyframes change
- Interpolation changes
- Skin or attachment changes
- Puppet facing changes
- Relevant rig/preview transforms change

Ghosts must not force changes to the active puppet's current pose.

### 8. IK policy

Follow the sampling policy established in v0.5.3.1.

Do not silently capture or bake the active puppet's IK-corrected state.

If read-only procedural IK rendering is not yet supported, document the limitation and display authored-pose ghosts.

### 9. Input safety

Ghost sprites are non-interactive.

They must not:
- Capture pointer events
- Block bone selection
- Block dragging
- Block timeline scrubbing
- Interfere with transform manipulators

Preserve Rig Editor and Animation Editor interaction behavior.

### 10. Cleanup

When ghosts are disabled, animation changes, or editor closes:
- Hide or release ghost rendering resources appropriately
- Remove obsolete listeners
- Avoid leaked Phaser GameObjects
- Avoid retained references to disposed textures or characters

### 11. Tests and manual checks

Add automated tests for feasible renderer/controller logic.

Manually verify:
- Previous/current/next alignment
- Different arm and leg positions
- Nested bone rotations
- Correct sprite origins
- Render depth
- Skin switching
- Facing left/right
- Scrubbing
- Playback
- Onion toggle
- Start/end animation boundaries
- No blocked pointer interactions

### 12. Scope restrictions

Do NOT implement:
- More than one ghost per direction
- Adjustable opacity
- Custom tint controls
- Adjustable ghost spacing
- Ghost keyframe authoring
- IK baking
- Mirrored animation tools
- Ghost export

Those belong to later milestones.

### 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Previous and next ghost poses render
- Ghosts match sampled transforms and current artwork
- Translucency and visual distinction work
- Toggle works
- Scrubbing/playback update ghosts
- Ghosts do not interfere with editing
- Ghosts do not mutate authored animation
- No obvious resource leaks
- Tests, typecheck and build pass

## Final report

Explain:
1. Ghost renderer architecture
2. Transform and attachment handling
3. Visual layering
4. Update synchronization
5. IK behavior
6. Resource lifecycle
7. Files/APIs changed
8. Tests and manual verification
9. Required command results
10. Deferred work

Do not claim completion unless the required commands pass.
