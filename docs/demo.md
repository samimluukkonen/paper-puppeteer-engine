# Demo controls and behavior

[All guides](../README.md#guides)

The demo shares the Animation Editor's compact viewport layout: navigation and character selection at the top, a command bar, a large canvas, and a scrolling Controls panel on the right. Playback status stays below the canvas. On narrow screens, the **Controls** button opens the panel; Close or Escape returns focus to that button. **Help** opens a modal dialog, and **Reset layout** closes the drawer and resets panel scrolling while preserving playback and scene settings.

Shortcuts leave form controls and editable text alone. Ctrl/Cmd combinations and composition input retain browser behavior; Alt is reserved for pose translation. Space activates a focused button or link normally. Held Q/E rotation is suspended while editing a form control.

| Key                           | Action                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `1`                           | Play / restart idle                                                                                   |
| `2`                           | Play / restart walk                                                                                   |
| `3`                           | Two-handed katana stance; enables hand IK                                                             |
| `4` / `5`                     | Crossfade to idle / walk over 300 ms                                                                  |
| `S`                           | Toggle smooth / stepped playback                                                                      |
| `8` / `0`                     | Set stepped playback to 8 / 10 FPS                                                                    |
| `L`                           | Toggle the masked upper-body sword layer                                                              |
| `P`                           | Pause / resume animation clocks                                                                       |
| `[` / `]`                     | Decrease / increase playback speed by 0.25×                                                           |
| `A` / `D`                     | Face left / right                                                                                     |
| `B`                           | Toggle joint pivots, hierarchy lines, and bone names                                                  |
| `I`                           | Toggle IK targets, joints, chain lines, lengths, bend signs and names                                 |
| `H`                           | Toggle mouse-controlled right-hand IK                                                                 |
| `F`                           | Toggle fixed world-space foot targets and gentle body sway                                            |
| Mouse                         | Move the hand target while hand IK is enabled                                                         |
| `Q` / `E`                     | Rotate the katana in either pose; the right-facing two-handed rear palm stays visible beside the body |
| `T`                           | Hide / show the katana                                                                                |
| `K` / `M`                     | Select default / armored skin                                                                         |
| `G`                           | Swap open / gripping right hand                                                                       |
| `N`                           | Toggle the headwear skin override                                                                     |
| `V`                           | Toggle slot markers, names, parent bones, and attachment names                                        |
| `Space`                       | Stop at the current pose / restart                                                                    |
| `R`                           | Restart the current clip                                                                              |
| `O`                           | Enter / exit pose authoring mode                                                                      |
| `C` (pose mode)               | Apply the sample combat-ready pose                                                                    |
| `R` (pose mode)               | Reset to bind pose                                                                                    |
| `[` / `]` (pose mode)         | Select previous / next bone                                                                           |
| `←` / `→` (pose mode)         | Rotate selected bone by 0.01 radians; `Shift` uses 0.1                                                |
| `Alt` + `←` / `→` (pose mode) | Move selected bone's local x by 1; `Shift` uses 5                                                     |
| `↑` / `↓` (pose mode)         | Move selected bone's local y by 1; `Shift` uses 5                                                     |
| `U` (pose mode)               | Reset selected bone to its bind transform                                                             |
| `X` (pose mode)               | Print, copy, and download pose JSON                                                                   |
| `J` (pose mode)               | Print normalized rig JSON to the console                                                              |

To compare playback styles, press `2`, then `S` and `8`. The walk pose updates eight times per second while Phaser continues rendering and IK still solves every frame. Press `S` again for smooth motion. Press `4` and `5` to compare crossfades in both directions. Press `L` during walking to keep the legs walking under a sword-ready upper body. The status panel shows the current event, transition progress, playback speed and layer state.

To verify the hierarchy, press `2`, then `B`: elbow, wrist, and hand follow the upper arm; knee, ankle, and foot follow the thigh. Press `A` and `D` to see the entire skeleton mirror while the labels stay readable. Press `Space` to freeze a pose. `T` demonstrates attachment ownership.

The single `T` control shows a sprite attachment in the right-hand item slot during idle and walk. The sword stance uses the existing grip-aware Phaser prop so its second hand can follow the hilt. Both respond to `Q` / `E` with the same facing-aware angle. Switching poses changes the visual representation without showing two swords.

Press `H` and move the mouse over the stage to aim the right wrist. Press `I` to inspect the chain and residual line to an unreachable target. Press `F` to plant the feet while walking; they alternate between a grounded stance and a lifted return step. Idle and sword use their authored, nearly straight leg pose. Press `3`, then rotate with `Q` / `E`: the left wrist follows the second katana grip. Switching to idle or walk disables hand IK; foot IK has its own toggle. Turn off `F` to inspect the original authored gait.

The two-handed katana stance reuses idle's pelvis bob, leg rotations, and facing-dependent hip positions. This keeps the lower-body pose the same when switching between idle and the stance, even when foot planting is enabled for walking.

Each limb has a consistent color across all its pieces: left arm blue, right arm purple, left leg coral, and right leg gold. The legend beside the stage identifies them; it moves below the stage on narrower screens.

The walk is authored facing right: thighs swing forward and backward, knees stay fairly straight through stance and flex for the shorter return swing, and the legs alternate half a cycle apart. A smaller pelvis rise and gentler foot lift keep the knees from folding too deeply. Walking uses the same thigh attachment points on the pelvis as idle for each facing direction. Mirroring the root reverses the whole gait for left-facing playback. Right-facing idle tilts the right arm slightly toward screen-left and the left arm slightly toward screen-right.

During walking and idle, the whole left arm draws behind the body when facing right, and the whole right arm draws behind the body when facing left; the other arm draws in front of the body. The near leg draws in front of the pelvis and the far leg: the right leg when facing right, and the left leg when facing left. During walking and idle in both directions, the left arm attaches to the screen's right-side shoulder and the right arm to the left-side shoulder. Both animations swap hip positions when facing right and keep the default hip positions when facing left. The right elbow bends inward in idle and has a stronger bend during walking; both bends mirror with facing. Props follow their hand's draw slot.
