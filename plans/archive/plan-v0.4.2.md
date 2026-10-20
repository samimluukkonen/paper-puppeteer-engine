Continue the existing `paper-puppeteer-engine`.

Do NOT rewrite existing systems.

This is **v0.4.2**.

v0.4.1 already introduced:

- serializable rig definitions
- serializable animation definitions
- JSON parsing
- data versioning
- runtime validation

The goal of v0.4.2 is to separate the **skeleton** from the **visual artwork**.

Implement:

1. named slots
2. sprite attachments
3. runtime attachment swapping
4. skins
5. partial skin overrides
6. slot debug visualization

## Core architecture

Keep these concepts separate:

```text
Bone
= transform / hierarchy

Slot
= location where something visual can appear

Attachment
= actual visual object placed in a slot

Skin
= mapping of slots to attachments
```

IK and animations should continue to operate on bones.

Changing artwork must not alter skeletal geometry.

## Slots

Add named slots attached to bones.

Example:

```json
{
  "id": "rightHandVisual",
  "bone": "rightHand",
  "depth": 20
}
```

Other examples:

```text
headVisual
face
headwear
torsoVisual
leftHandVisual
rightHandVisual
rightHandItem
hipWeapon
```

A slot should support at least:

- id
- parent bone
- render depth/order
- optional local x/y
- optional local rotation
- optional scale

## Sprite attachments

Add a serializable sprite attachment definition.

For example:

```json
{
  "id": "katana",
  "texture": "katana",
  "x": 4,
  "y": 2,
  "rotation": 0,
  "originX": 0.2,
  "originY": 0.5
}
```

Support:

```ts
interface SpriteAttachmentDefinition {
  id: string;
  texture: string;
  frame?: string;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  originX?: number;
  originY?: number;
}
```

The optional `frame` field is important for future texture atlas support.

Do NOT require texture atlases yet.

## Runtime attachment API

Provide an API approximately like:

```ts
puppet.setAttachment("rightHandItem", "katana");
```

```ts
puppet.clearAttachment("rightHandItem");
```

Allow replacing visual body parts:

```ts
puppet.setAttachment("rightHandVisual", "rightHandGrip");
```

This must support use cases such as:

- open hand → sword grip hand
- neutral face → speaking face
- eyes open → closed
- helmet on/off
- weapon switching
- damaged armor

## Preserve render order

Slot depth must preserve the existing paper-puppet rendering logic.

For example:

```text
far arm
far hand
torso
near arm
near hand
weapon
```

Changing skin or attachment must not accidentally alter that ordering.

## Skins

Implement skin definitions.

Example:

```json
{
  "version": 1,
  "name": "default",
  "slots": {
    "headVisual": "headDefault",
    "torsoVisual": "torsoDefault",
    "rightHandVisual": "rightHandOpen"
  }
}
```

Another skin:

```json
{
  "version": 1,
  "name": "armored",
  "slots": {
    "headVisual": "helmetedHead",
    "torsoVisual": "armoredTorso"
  }
}
```

Runtime:

```ts
puppet.setSkin("default");
```

```ts
puppet.setSkin("armored");
```

Changing skins must NOT rebuild the skeleton.

Animations and IK must continue working.

## Partial skin overrides

Support partial skins.

For example:

```json
{
  "version": 1,
  "name": "helmet-only",
  "slots": {
    "headwear": "kabuto"
  }
}
```

Support a reasonable API such as:

```ts
puppet.setSkin("default");
puppet.applySkin("helmet-only");
```

Do not overengineer skin stacking.

A base skin plus overrides is enough.

## Validation

Extend validation to detect:

- slot references missing bone
- duplicate slot IDs
- attachment references invalid texture definition where known
- skin references unknown slot
- skin references unknown attachment
- unsupported skin format version

Warnings may be used where appropriate.

## Interaction with IK

This is critical.

IK must remain bone-based.

Example:

```text
rightHand bone
   ↓
rightHandVisual slot
   ↓
rightHandGrip attachment
```

Swapping `rightHandOpen` for `rightHandGrip` must not affect hand IK.

## Interaction with facing

All slot/attachment/skin behavior must work when facing left or right.

Use the existing mirroring behavior.

Do not create duplicate left-facing artwork requirements.

## Demo

Extend the demo with:

- default skin
- alternate skin
- open hand
- gripping hand
- katana attachment
- headwear attachment

Suggested controls:

```text
K = default skin
L = alternate skin
H = toggle hand attachment
J = toggle katana
N = toggle headwear
V = slot debug
```

Use non-conflicting keys if necessary.

## Slot debug visualization

Add:

```ts
puppet.setSlotDebug(true);
```

Display where practical:

- slot position
- slot name
- parent bone
- current attachment

Keep debug visualization separate from runtime logic.

## Tests

Add tests for:

- slot validation
- skin validation
- attachment assignment
- attachment clearing
- skin switching
- partial skin overrides
- skeleton unchanged after skin switch
- IK bone references unchanged after sprite swaps

## Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Manually verify:

- skin switching works
- hand swapping works
- katana attachment works
- render depth remains correct
- facing remains correct
- IK still works
- animation still works

## Success criteria

v0.4.2 is complete when artwork can be changed independently of the skeleton.

I should be able to:

1. switch an entire skin
2. replace an individual hand
3. add/remove a helmet
4. attach/detach a katana
5. keep animation and IK functioning normally

At the end report:

- files added
- files changed
- public API additions
- slot architecture
- attachment architecture
- skin architecture
- validation additions
- known limitations
