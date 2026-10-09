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
              <td>Move a joint or slot</td>
              <td>Drag its canvas marker</td>
            </tr>
            <tr>
              <td>Edit artwork offset</td>
              <td>Choose Sprite mode, then click and drag artwork; selecting its bone also works</td>
            </tr>
            <tr>
              <td>Nudge a joint</td>
              <td>
                Arrow keys; hold <kbd>Shift</kbd> for larger steps
              </td>
            </tr>
            <tr>
              <td>Rotate a joint</td>
              <td>
                <kbd>,</kbd> / <kbd>.</kbd>; hold <kbd>Shift</kbd> for larger steps
              </td>
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
