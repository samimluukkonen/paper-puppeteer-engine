# Character assets and rig data

[All guides](../README.md#guides)

## External characters

The primary demo loads [character.json](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/public/characters/demo-puppet/character.json) from `public/characters/demo-puppet/`. The folder contains `rig.json`, three skin files, four animation files, `poses/combat-ready.json`, and transparent PNG files under `images/`. The combat idle file has the runtime clip name `sword`; file names and stable animation IDs can differ.

The version 1 manifest names a rig path, a default skin key, skin keys mapped to JSON paths, animation and optional pose JSON paths, and Phaser texture keys mapped to image paths. All paths resolve relative to `character.json`, using its final response URL after redirects. Custom fetchers with an empty response URL fall back to the requested manifest URL. Texture keys are separate from bone, slot, and attachment IDs. `frame` on an attachment or legacy bone sprite selects an atlas frame when the host has preloaded an atlas under the named texture key. The sample uses ordinary PNGs.

```json
{
  "version": 1,
  "id": "demo-puppet",
  "rig": "rig.json",
  "defaultSkin": "default",
  "skins": { "default": "skins/default.json", "alternate": "skins/alternate.json" },
  "animations": ["animations/idle.json", "animations/walk.json"],
  "poses": ["poses/combat-ready.json"],
  "textures": { "paper-head": "images/paper-head.png" }
}
```

`CharacterLoader.load` fetches JSON metadata only. Queue images through Phaser after loading the metadata, then construct the puppet when Phaser reports completion:

```ts
import Phaser from 'phaser';
import { CharacterLoader, Puppet, queueCharacterTextures } from 'paper-puppeteer-engine';

const definition = await CharacterLoader.load('/characters/demo-puppet/character.json');
queueCharacterTextures(scene, definition);
scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
  const puppet = new Puppet(scene, { definition, x: 500, y: 500 });
  puppet.play('idle');
});
scene.load.start();
```

Metadata loads accept an optional third argument, `CharacterLoadOptions`. Use
`CharacterLoader.load(url, fetch, { signal: controller.signal })` with an `AbortController` to cancel
the manifest and its related files. A failed metadata request also cancels sibling requests and
preserves the original error. Custom fetch implementations remain supported as the second argument;
they must honor `RequestInit.signal` to cancel pending I/O.

Metadata loading defaults to 10 MiB per JSON response, 50 MiB of JSON for the whole load,
256 resources (the manifest, unique metadata paths, and texture entries combined), and six concurrent
metadata requests. Streaming byte checks also cover responses with missing or misleading
`Content-Length` headers. Exceeding a limit rejects with `JsonInputLimitError` and cancels pending
requests. Adjust these positive integer limits for larger trusted characters, for example
`CharacterLoader.load(url, fetch, { maxJsonBytes: 20 * 1024 * 1024, maxResources: 512, concurrency: 4 })`.
`DEFAULT_CHARACTER_LOAD_LIMITS` exposes the defaults. Image byte limits belong to the host's texture loader;
already parsed values passed to `CharacterDefinition.fromData` bypass these I/O limits.

Each metadata request has a 30-second timeout covering headers and the decoded body. A timeout
rejects with a `TimeoutError` and cancels sibling requests. Configure `timeoutMs` as a positive integer
no greater than `2147483647`; successful, failed, and canceled requests release their timers.

For external assets, pass a synchronous `urlPolicy` that explicitly approves resolved destinations:

```ts
const definition = await CharacterLoader.load('https://assets.example.com/hero/character.json', fetch, {
  timeoutMs: 10_000,
  urlPolicy: (url) => url.protocol === 'https:' && url.origin === 'https://assets.example.com',
});
```

The policy checks the manifest, all metadata paths, texture paths, and reported response URLs.
Related destinations are checked before any related requests start. Supplying a policy sets
`RequestInit.redirect` to `'error'` so redirects cannot bypass approval. Without a policy, existing
redirect and custom-I/O behavior remains available. Custom fetchers must honor both `signal` and
`redirect`. A URL policy does not resolve DNS or inspect connected IP addresses; server hosts loading
untrusted manifests must enforce private-network restrictions in their fetch implementation or
network environment. The host's image loader must also enforce its own redirect and timeout policy.

For Phaser `preload`, custom pipelines, generated content, or tests, pass already parsed values to `CharacterDefinition.fromData({ manifest, rig, skins, animations, poses }, optionalManifestUrl)`. The `skins`, `animations`, and `poses` objects are indexed by the paths in the manifest. `queueCharacterTextures` skips texture keys already loaded in the scene, so an app can preload an atlas itself. `definition.textureUrl(key)` resolves a key to a URL when given a manifest URL; without one it returns the authored path. `new Puppet(scene, { rig, animations, poses, skin })` and TypeScript-authored rigs and clips continue to work.

Character assembly preserves skins embedded in the rig. A standalone skin declared in the manifest replaces an embedded skin with the same name; embedded skins with other names remain available at runtime. `definition.standaloneSkins` exposes immutable manifest-owned skins separately from `definition.rig.skins`, which contains the merged runtime selection. The original rig file retains its authored skin definitions for editor reloads and exports, and editor previews use the same precedence as runtime.

Texture keys are shared across every scene in a Phaser game. Use unique keys such as `hero-body` and `enemy-body` for different artwork, updating the manifest and rig texture references together. `queueCharacterTextures` tracks queued and loaded character image URLs and rejects a conflicting key before queueing any files. Identical URLs can share a key, and host-preloaded atlas keys retain their intentional override. Failed loads and scene shutdown release pending reservations. The helper returns a cleanup callback for hosts that cancel a load themselves; call it after canceling the loader to release reservations and listeners.

Character definitions own independent, deeply frozen JSON data. Their animation, pose, texture, and original rig-file views use readonly types; clone them with `structuredClone` into an authored definition type before editing. The runtime rig remains immutable too.

`rig.getBone(id)`, `rig.getSlot(id)`, and `rig.getAttachment(id)` provide indexed access to immutable definitions and throw when an ID is unknown. `rig.getAttachment(id)` returns an artwork definition; `puppet.getAttachment(slotId)` returns the attachment ID currently assigned to a slot.

`validateCharacterDefinition(data)` returns structured `{ severity, path, message }` issues without Phaser. It checks the manifest version and shape, missing files, default skin, skin and slot references, attachment texture keys, duplicate animation names, and animation bone references in addition to the existing rig and timeline rules. `CharacterDefinition.fromData` throws `CharacterValidationError` with those issues. Validation checks declared texture keys and image paths; image bytes and atlas frame existence are checked by Phaser at load or Puppet construction.

### Artist workflow

```text
Artist exports transparent PNG body parts
  ↓ developer assigns stable texture keys
rig.json defines skeleton and pivots
  ↓ slots connect visuals to bones
skins/*.json choose attachments
  ↓ animations/*.json reference stable bone IDs
character.json ties the files together
```

Export near and far limbs separately, as well as weapons and alternate hand states. Keep a consistent resolution and enough transparent canvas near joints. The image center is not the joint pivot: rig bone positions define the skeleton, while attachment `x`/`y` offset the image and `originX`/`originY` set its normalized pivot within the image. Adjust these values in JSON to align art without re-exporting PNGs. Keep asset filenames and texture keys independent of bone IDs such as `leftUpperArm`, `leftForearm`, and `leftHand`.

`Rig`, animation registration and IK constraint construction validate plain input with Zod before applying hierarchy and timeline rules. Their underlying `rigDefinitionSchema`, `animationClipSchema` and `twoBoneIKDefinitionSchema` are also public. Use the versioned parsers below for external rig and animation files; they add version, JSON compatibility, hierarchy and timeline checks. Validation runs when definitions are loaded or registered, not during animation frames.

## Load versioned JSON

Identifiers (bone, slot, attachment, texture, skin, animation, event, pose, character, and IK names and references) are nonempty strings. `__proto__` is reserved and rejected before parsing or pose serialization because record parsers discard that key. Other names, including `toString`, `constructor`, and `prototype`, are allowed. Dictionary lookups use only own entries; inherited texture and file names do not resolve. File paths and descriptive metadata are separate from identifiers.

The external formats currently use `RIG_FORMAT_VERSION = 1` and `ANIMATION_FORMAT_VERSION = 1`. A rig file has `version`, optional `name`, `root`, and `bones`. Bone records use `id`, optional `parent`, local `x`, `y`, `rotation`, `scaleX`, `scaleY`, optional nonnegative `length`, optional `depth`, and optional `sprite` with texture/frame, offsets, normalized origins, scales, and depth. The bone container origin is its pivot. An animation file has `version`, `name`, positive `duration` in milliseconds, `loop`, `tracks` keyed by bone id, optional `events`, and optional `playback` (`{ "mode": "smooth" }` or `{ "mode": "stepped", "fps": 10 }`). Keyframes have `time` and any of the five local transform properties. See [rig.json](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/public/characters/demo-puppet/rig.json) and [idle.json](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/public/characters/demo-puppet/animations/idle.json).

```ts
import {
  parseRigDefinition,
  parseAnimationClip,
  validateRigDefinition,
  validateAnimationDefinition,
  validatePoseDefinition,
  Puppet,
} from 'paper-puppeteer-engine';

// Load the files with your app's own I/O (fetch, imports, or a file system).
const rig = parseRigDefinition(rigJson);
const idle = parseAnimationClip(idleJson, rig);
const puppet = new Puppet(scene, { rig, animations: [idle] });

// For editor-style diagnostics, inspect all reported issues without throwing.
const rigIssues = validateRigDefinition(rigJson);
const animationIssues = validateAnimationDefinition(idleJson, rig);
const poseIssues = validatePoseDefinition(poseJson, rig);
```

The parsers accept already-loaded JavaScript values and require no `fetch`. They return the existing `Rig` and `AnimationClip` runtime types. Invalid files throw `RigValidationError` or `AnimationValidationError`, each with an `issues` array of severity, path, and message. Unsupported versions throw `UnsupportedFormatVersionError`. Validation catches duplicate and missing bones, invalid parents and cycles, nonfinite transforms, negative lengths, invalid timeline times, unknown track bones, invalid FPS, and non-JSON values such as functions, `Map`, `Set`, and cyclic references. Existing unversioned TypeScript `RigDefinition` and `AnimationClip` inputs still work through their original constructors and registration APIs. The external format has no migration support yet.

External JSON supports at most 256 nested object/array levels, including event payloads. Deeper input returns a validation issue before parsing, cloning, or serialization can overflow the call stack.

Pose validation uses the same severity/path/message diagnostics through `validatePoseDefinition`. Character validation preserves every pose issue with its file prefix, such as `poses[0].bones.arm.rotation`, so tools can highlight individual fields. `parsePoseDefinition` retains its `PoseValidationError` and `UnsupportedFormatVersionError` behavior.

## Slots, sprite attachments, and skins

Bones define the hierarchy and joint geometry. A named slot follows one bone and holds one sprite attachment at a time. Attachments define texture, optional atlas frame, local offset, rotation, scale, and normalized origin. A skin maps slot IDs to attachment IDs. All three are serializable parts of a rig definition; skin format version is `1`.

```ts
const rig: RigDefinition = {
  root: 'root',
  bones: [{ id: 'root' }, { id: 'hand', parent: 'root', y: 40 }],
  slots: [{ id: 'handVisual', bone: 'hand' }, { id: 'handItem', bone: 'hand', depth: 20 }],
  attachments: [
    { id: 'open', texture: 'hand-open', originY: 0.2 },
    { id: 'grip', texture: 'hand-grip', originY: 0.2 },
    { id: 'katana', texture: 'katana', x: 4, y: 2, rotation: -0.5 },
  ],
  skins: [
    { version: 1, name: 'default', slots: { handVisual: 'open' } },
    { version: 1, name: 'sword-hand', slots: { handVisual: 'grip', handItem: 'katana' } },
  ],
};
const puppet = new Puppet(scene, { rig, skin: 'default' });
puppet.setSkin('default');       // Replace the complete selection; omitted slots become empty.
puppet.applySkin('sword-hand');   // Override only listed slots.
puppet.setAttachment('handItem', 'katana');
puppet.clearAttachment('handItem');
puppet.getAttachment('handVisual'); // Attachment ID or undefined.
puppet.getSlotImage('handVisual');  // Current Phaser image or undefined.
puppet.setSlotDebug(true);
puppet.setSlotDepth('handVisual', 50); // Override draw depth at runtime.
puppet.clearSlotDepth('handVisual');   // Restore rig depth or automatic placement in the current order.
```

Use `null` in a skin mapping to clear one slot during `applySkin`. Slot `x`, `y`, `rotation`, `scaleX`, and `scaleY` transform the attachment relative to its parent bone. Slot `depth` sets global draw depth; without it, the slot follows its bone in `setRenderOrder`, just in front of the bone's legacy image. Slots attached to the same bone draw in definition order at equal depth. Changing a skin or attachment leaves bone objects, animation tracks, and IK references intact. The puppet's outer facing mirror applies to slots and attachments automatically. Legacy `bone.sprite` definitions and Phaser object `attach`/`detach` continue to work.

Validation reports duplicate slot and attachment IDs, missing parent bones, unknown skin slots or attachments, unsupported skin versions, and malformed transforms. `Puppet` checks texture keys and frame names against the Phaser scene when it is constructed. Texture atlases are optional; an attachment can name an ordinary texture.

## Define a rig

Definitions are plain serializable data. Bone IDs must be unique. There is exactly one root; every other bone needs a valid parent. Bones may appear in any order; cycles and invalid transforms are rejected.

```ts
import { Puppet, type RigDefinition } from 'paper-puppeteer-engine';

const rig: RigDefinition = {
  root: 'root',
  bones: [
    { id: 'root' },
    {
      id: 'upperArm', parent: 'root', x: 0, y: -50,
      sprite: { texture: 'upper-arm', originX: 0.5, originY: 0.1 },
    },
    {
      id: 'forearm', parent: 'upperArm', x: 0, y: 60,
      sprite: { texture: 'forearm', originX: 0.5, originY: 0.15 },
    },
    { id: 'hand', parent: 'forearm', y: 45, sprite: { texture: 'hand', originY: 0.2 } },
  ],
};

// Load these texture keys through your Phaser scene before constructing the puppet.
const puppet = new Puppet(scene, { x: 400, y: 300, rig });
puppet.setDebug(true);
```

`x`, `y`, `rotation`, `scaleX`, and `scaleY` define a bone's **local bind pose** relative to its parent. Positions use pixels, rotations use **radians** (positive clockwise in Phaser's downward Y axis), and scales default to 1. Each container's `(0, 0)` is its joint/pivot. Rotating an upper arm therefore carries the elbow, forearm, and hand automatically.

`sprite.originX` / `originY` are normalized image origins in `[0, 1]`; put them at the shoulder/elbow/etc. within the texture, rather than assuming the center. `sprite.x` / `y` offset the image relative to the joint, and `sprite.scaleX` / `scaleY` scale only the image. Bone scale affects descendants too. `sprite.frame` selects an atlas/spritesheet frame. Transparent images are supported directly.

IK normally measures the current joint-to-child offsets, including effective chain scale. Optional `length` overrides the logical bind distance to each direct child. `Rig` normalizes the child's `x`/`y` to that length while keeping its direction; a child with no offset defaults to positive Y. For example, an upper arm with `length: 52` places its elbow 52 logical pixels from its shoulder, regardless of image height. Images keep their original dimensions. Position animation can subsequently change that distance, and IK measures the evaluated offsets. Lengths must be finite and nonnegative.

`depth` orders subtrees among siblings for the default drawing order; `sprite.depth` determines where the parent's image appears relative to its children. The engine derives a global back-to-front order from these defaults. To interleave unrelated branches, pass every bone ID exactly once to `puppet.setRenderOrder(ids)`. `puppet.getRenderOrder()` returns the current order; `puppet.resetRenderOrder()` restores the rig default. Bones without images still have a draw slot for attachments. The skeleton's parenting stays unchanged when the order changes.

Debug crosses and outlined circles mark joint pivots; orange dots mark sprite origins (which may differ if the image has an offset). Lines connect parents and children. Names remain upright when mirrored.

Use `puppet.setDebugLabelSide('boneId', 'left')` or `'right'` to choose the screen side of a pivot label. Omit the side to restore automatic placement. In the demo's idle pose, the near knee label faces outward: right lower leg to the left when facing right, and left lower leg to the right when facing left. The left foot label stays to the right in right-facing idle, and the right foot label stays to the left in left-facing idle.
