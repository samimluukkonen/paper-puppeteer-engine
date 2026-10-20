# Paper Puppeteer Engine — v0.6.6.1
## New Character Workspace

Continue developing my Paper Puppeteer Engine project.

**Current production milestone: v0.6.5**

Technology stack:
- React + TypeScript (strict) for the editors
- Phaser for rendering
- Vite, npm, ES modules

Existing features include the Rig Editor, Animation Editor, artwork import/replacement, slots, attachments, skins, animation authoring, and character package export.

Do not rebuild these systems.

## Goal

Implement a **Create New Character** workflow.

Currently my project has two example characters:
- demo puppet
- random-paperdoll-sketch

I want artists to create their own characters entirely from scratch.

**Do not clone or modify either example character.**

### 1. Inspect existing character architecture

Before changing code, inspect:
- Character manifest schema
- RigDefinition schema
- Character workspace/session model
- Rig Editor initialization
- CharacterLoader
- Existing character selection UI
- Asset and skin definitions
- Existing validators and serializers

Use the actual existing types and conventions.

### 2. New Character button

Add a prominent **+ New Character** button to the appropriate character selection/workspace UI.

It must be accessible even when no character is loaded.

Existing characters must continue working normally.

### 3. React creation dialog

Create a dialog with:

- Character name
- Character ID (automatically suggested, editable)
- Optional description if supported by existing schema

Example:

```text
CREATE NEW CHARACTER

Name:
[ Forest Guardian ]

Character ID:
[ forest-guardian ]

[ Cancel ] [ Create Character ]
```

Validate inputs and reject duplicate IDs.

Do not assume the user has imported any artwork.

### 4. Fresh character definition

Implement a centralized creation function using existing schemas.

Conceptually:

```ts
createNewCharacter(options): CharacterWorkspace
```

The new character must have:
- A unique character identity
- Its own rig definition
- Its own character manifest
- No existing animations
- No imported artwork
- Appropriate empty/default skin state
- Independent working documents

Create only the minimum default root bone or structural data required by the real rig schema.

Do not copy bones, sprites, animation tracks, or other assets from the demo characters.

### 5. Empty Rig Editor

After creation, open the new character in the Rig Editor.

Show:
- Empty or minimal skeleton
- Bone hierarchy
- Character information
- Rig-editing controls
- Artwork import access

The editor must not crash when no artwork, attachments or animations exist.

Display useful empty-state guidance.

### 6. Document lifecycle

The newly created character is an **unsaved draft**.

Integrate with existing:
- Working-copy ownership
- Dirty-state tracking
- Undo/Redo
- Unsaved-change protection
- Character switching

Creating a new character must not modify existing characters.

Failed creation must leave the existing workspace unchanged.

### 7. Validation

Use existing validators.

Distinguish between:
- A valid incomplete editing draft
- A valid production/exportable character

Do not introduce meaningless dummy artwork merely to satisfy production validation.

If the current schema requires complete references, support a clearly identified incomplete draft until the artist supplies them.

### 8. Tests

Test:
- Create character with no existing character loaded
- Create while another character is loaded
- Duplicate ID rejection
- Invalid names/IDs
- Minimal rig initialization
- Empty animation collection
- Empty artwork collection
- Workspace switching
- Unsaved changes
- Source character isolation
- Transactional failure

### 9. Out of scope

Do not yet implement:
- New bone-creation tools
- Automatic skeleton generation
- Character templates
- AI artwork generation
- New animation systems
- Scene choreography

### 10. Verification

Run and fix failures:

```bash
npm run typecheck
npm run test
npm run build
```

## Definition of done

An artist can click **New Character**, enter a name, and open a completely new independent character in the Rig Editor without any existing character JSON or artwork.

Existing demo characters remain unchanged.

## Final report

Provide:
1. Implemented functionality
2. New-character factory and workspace architecture
3. Initialization and validation rules
4. Files/APIs changed
5. Tests
6. Exact command results
7. Deferred v0.6.6.2 work

Do not claim completion unless required checks pass.
