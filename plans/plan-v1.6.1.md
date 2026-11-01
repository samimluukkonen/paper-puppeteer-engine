# Paper Puppeteer Engine — v1.6.1
## Linear Story Data Model & Scene Sequencing

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.5.6**

### Technology
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

The project already includes:
- Rig, Animation and Scene Editors
- Project Workspace
- Scene timeline and deterministic evaluation
- Actor choreography and root motion
- Camera animation, cuts and fades
- Audio and dialogue
- Animation retargeting and reusable scene templates
- Import/export and autosave/recovery

This application is privately used by myself and one artist friend.

### Important product requirement

Paper Puppeteer Engine is used to author Mukashi Monogatari, a LINEAR cinematic storytelling experience.

The viewer's only intended interaction is advancing dialogue with Enter or an equivalent configured input.

Do NOT introduce:
- Player-controlled characters
- Gameplay mechanics
- Story choices
- Conditional narrative branching
- Quest systems
- A visual scripting language

## Goal

Implement the foundation for creating complete stories from ordered, existing cinematic scenes.

A story contains a sequence of scene references and plays them in a defined order.

## 1. Inspect current architecture

Review:
- Project asset registry
- SceneDefinition
- Scene runtime/loading
- Existing scene transition support
- Scene duration and completion
- Project schema/versioning
- Dependency validation
- Export/import
- Autosave and recovery

Reuse existing systems.

## 2. Story data model

Introduce a typed StoryDefinition or equivalent.

Conceptually:

```ts
interface StorySceneEntry {
  id: string;
  sceneAssetId: string;
}

interface StoryDefinition {
  id: string;
  name: string;
  scenes: StorySceneEntry[];
}
```

Adapt this to existing project conventions.

Support:
- Stable story identity
- Display name
- Description, if useful
- Ordered scene entries
- Stable entry IDs
- References to existing scene assets
- Optional transition metadata using existing scene transition capabilities

Do not duplicate entire SceneDefinitions inside stories.

## 3. Linear sequencing

A story plays scenes in their authored order.

Example:

Scene A → Scene B → Scene C → End

No branches, choices or conditions.

When one scene finishes, the story player advances to the next scene automatically.

Dialogue holds will be introduced in v1.6.2.

## 4. Scene references

Allow the same SceneDefinition to be referenced multiple times if useful.

Distinguish:
- Scene asset ID
- Story entry ID
- Runtime scene instance

Do not confuse shared assets with mutable playback state.

## 5. Story validation

Validate:
- Unique story IDs
- Unique entry IDs
- Missing scene assets
- Invalid ordering
- Empty story
- Unsupported transition metadata
- Broken asset dependencies

An empty story may remain an editable draft but should not be considered playable.

## 6. Scene lifecycle abstraction

Introduce a small, reusable story sequencing abstraction independent of React.

It must support:
- Start first scene
- Advance to next scene on completion
- End story
- Stop
- Dispose

Do not recreate scene playback, actor choreography or animation evaluation.

This phase may provide the sequencing model/service without a complete viewer UI.

## 7. Shared resources

Identify how scene loading and unloading should reuse:
- Character assets
- Textures
- Audio assets
- Project asset references

Prevent ownership conflicts between scenes sharing the same assets.

Detailed preloading comes in v1.6.5.

## 8. Persistence

Ensure StoryDefinition survives:
- Project autosave
- Recovery
- Export/import
- Validation
- Reopening the project

Do not serialize live runtime state.

## 9. Tests

Cover:
- Single-scene story
- Multiple scenes
- Duplicate scene references
- Ordered playback
- Story completion
- Missing scene references
- Stop/dispose
- Serialization
- Backward compatibility
- Source scene immutability

## 10. Out of scope

Do not implement:
- Visual Story Editor
- Dialogue waiting
- Keyboard input
- Advanced scene preloading
- Branching
- Player choices
- Story variables
- Gameplay

## 11. Verification

Inspect actual repository scripts and run the equivalent of:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

The project can define and validate a linear sequence of existing cinematic scenes without duplicating scene documents or introducing interactive narrative logic.

## Final report

Provide:
1. Story schema
2. Scene-reference model
3. Sequencing semantics
4. Lifecycle integration
5. Persistence
6. Files/APIs changed
7. Tests
8. Exact verification results
