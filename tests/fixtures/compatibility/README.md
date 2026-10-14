# Compatibility fixtures

`minimal/` is the smallest loadable version-1 character: one joint, an empty standalone skin, no animations or artwork.

`complete/` exercises the existing version-1 fields with a three-joint IK chain, bone artwork, a slot/attachment, embedded and standalone skin precedence, explicit clearing, a static pose, events with JSON payloads, IK targets and baked constraint suppression. `baked.json` is a small authored bone-key clip with suppression metadata; the tests separately generate and commit a real bake through the production pipeline for smooth and stepped playback.

`v0.4.3/` contains **unaltered JSON documents** from repository commit `567cbc5` (`v0.4.3`), under `public/characters/demo-puppet/`. It includes the original manifest, rig, four animations and three skins. It predates pose manifest entries, playback metadata, IK tracks and baked suppression. Its data format is already version 1. No historical format or migration has been invented. Binary images are omitted because these tests load metadata without Phaser; shipped artwork and package image/frame checks have their own suites.

`invalid-manifests.json` contains labeled patches applied to the complete manifest. The unresolved-rig case omits that document from the assembled data as a failed filesystem lookup would.

Run `npx vitest run tests/schemaCompatibility.test.ts tests/characterPackage.test.ts` locally. Tests read these files directly and do not need git history or a network connection.
