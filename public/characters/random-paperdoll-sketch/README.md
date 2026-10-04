# Random paperdoll sketch

Artist exports remain in this folder under their original filenames. `character.json` loads the 14 separate transparent PNG pieces; the full `TEST 001 - Rando paperdoll sketch.png` is only a visual reference.

- Rig editor: `/rig-editor/?character=random-paperdoll-sketch`
- Engine demo: `/?character=random-paperdoll-sketch`
- Animation editor: `/animation-editor/?character=random-paperdoll-sketch`

The starter rig has an invisible pelvis joint, front (`right*`) and back (`left*`) limbs in its canonical right-facing pose, and a default skin. Artwork is displayed at 30% of its exported size. Joint coordinates and attachment offsets use display pixels; image origins use normalized coordinates within each original PNG. Lower legs draw behind the robe panels, back arms draw behind the body, and both hands draw behind their lower-arm sleeves.

The original reference faces left. The canonical bind pose mirrors its artwork and joint positions to face right: left/back limbs sit on screen right, and right/front limbs sit on screen left. The demo's Left button mirrors the artwork back into the reference orientation and swaps the actual arm and leg chains, their cutouts, and draw depths. Left-facing front limbs use `left*` bones and back limbs use `right*` bones. Foot IK follows those assignments. The right hand always holds the primary katana grip, the left hand holds the secondary grip, and grip-hand equipment stays on the right hand. Pose authoring uses the same layout and exports canonical right-facing pose data.

Adjust the bind pose in the rig editor, download `rig.json`, and replace the file here to see the revised rig in the demo after a refresh. The editor keeps edits in memory until you export; it does not overwrite this folder. The idle and walk animations are gentle test clips, ready to refine as the rig develops.

The walk follows the demo puppet's contact, passing, and return-step timing, with reduced thigh and arm swing for the robe and wide sleeves. Leg rotations compensate for this rig's angled hip-to-knee links so both knees bend backward, swing feet lift, and the soles remain nearly level.

All demo controls are enabled: arm and leg IK, foot planting, the two-handed katana, sword animation, upper-body layer, combat pose, equipment toggles, and debug views. With "Plant feet while walking" enabled, the sketch uses a longer stride, gentle knee bends, and a small body rise over the supporting leg. The forward leg extends for heel-first contact, then the foot rolls flat during the first tenth of the cycle. The trailing heel rolls up around the planted toe, and the toes lift during the return swing. Each forward reach is fitted to its leg length, and sole offsets keep the feet on the stage floor in both facing directions. Katana IK keeps the right hand on the primary grip and the left hand on the secondary grip in either facing direction.

The planted cycle uses approximately 60% contact and 40% swing, with heel rise starting near 35%, following the [University of Oklahoma gait reference](https://www.ouhsc.edu/bserdac/dthompso/web/gait/terms.htm). The stride and angles are reduced to suit the sketch's proportions and clothing.

Optional armor, grip-hand, headwear, and slot-katana attachments reuse textures from `../demo-puppet/images/`, fitted to this rig. The `katanaHilt` slot lets the demo draw the hilt behind the right leg when facing left while keeping the blade in front, in both one- and two-handed modes. The alternate skin adds armor while keeping the artist's head and torso. Combat animations and the combat-ready pose adapt the demo puppet's motions to the sketch's joint geometry.
