export function RigHelp() {
  return (
    <details className="shortcut-help">
      <summary>Controls and shortcuts</summary>
      <div className="shortcut-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Control</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Select a bone or slot</td>
              <td>
                Click the hierarchy or canvas; <kbd>Alt</kbd>+click prefers slots
              </td>
            </tr>
            <tr>
              <td>Move a joint / slot transform</td>
              <td>Choose Joint Editing / Slot Transform Editing and drag its marker</td>
            </tr>
            <tr>
              <td>Edit artwork offset</td>
              <td>Choose Artwork Offset Editing, then drag artwork or its pivot</td>
            </tr>
            <tr>
              <td>Nudge the current operation</td>
              <td>
                Arrow keys move joints, artwork offsets, or slot transforms in their explicit modes; hold{' '}
                <kbd>Shift</kbd> for larger steps
              </td>
            </tr>
            <tr>
              <td>Rotate a joint</td>
              <td>
                <kbd>,</kbd> / <kbd>.</kbd>; hold <kbd>Shift</kbd> for larger steps
              </td>
            </tr>
            <tr>
              <td>Edit sprite pivot</td>
              <td>
                Choose Sprite Origin Editing and drag across artwork, or enter normalized / pixel origins. Offset stays
                fixed.
              </td>
            </tr>
            <tr>
              <td>Cancel gesture</td>
              <td>
                <kbd>Escape</kbd>; leaving the window also cancels
              </td>
            </tr>
            <tr>
              <td>Inspect animation poses</td>
              <td>Choose a clip and time in preview options. Bone tracks only; joint/slot edits require Bind pose.</td>
            </tr>
            <tr>
              <td>Undo / redo</td>
              <td>
                <kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd> / <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>
              </td>
            </tr>
            <tr>
              <td>Snap translation / rotation</td>
              <td>Use Grid / Rotation snap in the command bar</td>
            </tr>
            <tr>
              <td>Reset selected / rig</td>
              <td>Use Reset Selected / Reset Rig in the command bar</td>
            </tr>
            <tr>
              <td>Validate / export</td>
              <td>Use the buttons in File tools</td>
            </tr>
            <tr>
              <td>Zoom / pan</td>
              <td>Mouse wheel / middle-button drag</td>
            </tr>
            <tr>
              <td>Move the whole character</td>
              <td>Left-button drag on the canvas background</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}
