Continue the existing `paper-puppeteer-engine`.

This is **v0.4.3**.

Do NOT rewrite stable systems.

The engine now supports:

- JSON rig definitions
- JSON animation definitions
- validation/versioning
- slots
- attachments
- skins
- IK
- animation blending/layers/events

The goal of this version is to make a complete character loadable from an external folder.

Focus on:

1. character manifests
2. character loading architecture
3. complete sample character
4. external animations/skins/assets
5. Phaser asset integration
6. full-character validation

## Character manifest

Introduce a higher-level character definition.

Conceptually:

```json
{
  "version": 1,
  "id": "demo-puppet",
  "rig": "rig.json",
  "defaultSkin": "default",

  "skins": {
    "default": "skins/default.json",
    "alternate": "skins/alternate.json"
  },

  "animations": [
    "animations/idle.json",
    "animations/walk.json",
    "animations/combat-idle.json"
  ]
}
```

Adjust format if a cleaner design is needed.

The manifest should describe how the pieces of one puppet character fit together.

## Character loader

Create loading architecture approximately like:

```ts
const definition = await CharacterLoader.load(
  "/characters/demo-puppet/character.json"
);
```

Then:

```ts
const puppet = new Puppet(scene, {
  definition,
  x: 500,
  y: 500,
});
```

Or provide another clean equivalent.

Keep:

```text
loading / I/O
```

separate from:

```text
runtime puppet behavior
```

## Do not force fetch

The core runtime should also accept already-loaded data.

For example:

```ts
CharacterDefinition.fromData(...)
```

or equivalent.

This is important because applications may use Phaser preload, custom asset pipelines, tests, or generated content.

## Phaser asset integration

Work sensibly with Phaser's asset loading.

Avoid building a completely separate generic asset manager.

Clearly separate:

- JSON metadata
- texture keys
- texture frames
- runtime Puppet creation

Support both:

```ts
{
  texture: "head"
}
```

and future atlas-style references:

```ts
{
  texture: "samurai-atlas",
  frame: "head.png"
}
```

## Complete sample character

Create:

```text
public/
  characters/
    demo-puppet/
      character.json
      rig.json

      skins/
        default.json
        alternate.json

      animations/
        idle.json
        walk.json
        combat-idle.json

      images/
        ...
```

Placeholder artwork is acceptable.

The important thing is proving the production data pipeline.

## Convert demo

Make the primary demo use the external character manifest.

Do NOT remove TypeScript-defined rigs/animations.

Both approaches should remain supported.

## Full-character validation

Implement something like:

```ts
validateCharacterDefinition(character);
```

It should validate relationships across files/data.

Examples:

- animation references missing bone
- skin references missing slot
- attachment references missing asset definition
- default skin does not exist
- duplicate animation names
- missing rig
- invalid character version

Use structured issues:

```ts
interface ValidationIssue {
  severity: "error" | "warning";
  path?: string;
  message: string;
}
```

## Asset naming

Use stable IDs.

For example:

```text
leftUpperArm
leftForearm
leftHand
```

Do not use filenames as skeleton identity.

Texture filenames and bone IDs must remain separate concepts.

## Artist workflow

Add README documentation for the expected artwork pipeline:

```text
Artist exports transparent PNG body parts
↓
developer assigns texture keys
↓
rig.json defines skeleton/pivots
↓
slots connect visuals to bones
↓
skin defines active visuals
↓
animations reference stable bone IDs
↓
character.json ties everything together
```

Artwork recommendations:

- transparent PNGs
- separate near/far limbs
- weapons separately
- multiple hand states separately
- consistent resolution
- sufficient transparent canvas near joints
- don't rely on image center as joint pivot
- allow rig data to compensate for sprite offsets

## Artist-independent pivots

Make sure rig/attachment data can adjust artwork without re-exporting images.

For example support equivalent data for:

```text
spriteOffsetX
spriteOffsetY
originX
originY
```

The artist should not need to repeatedly move pixels just to correct a joint.

## Demo tests

Demonstrate:

- external character loads
- default skin appears
- alternate skin works
- walk loads from JSON
- idle loads from JSON
- IK works
- katana works
- facing works
- stepped animation works

## Tests

Add tests for:

- valid character manifest
- missing rig
- missing default skin
- duplicate animation names
- invalid referenced resources
- unsupported version
- loading already-parsed character data

Avoid requiring Phaser rendering for pure data tests.

## Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

## Success criteria

v0.4.3 succeeds when a character can be represented mostly as:

```text
character.json
rig.json
skins/
animations/
images/
```

and loaded into Phaser without creating a character-specific TypeScript class.

At the end report:

- public APIs added
- manifest format
- loading flow
- Phaser integration decisions
- sample folder structure
- validation behavior
- backward compatibility
- known limitations
