import { downloadJson } from '../../shared/downloadJson.js';
import type { ArtworkController } from '../shared/artwork/ArtworkController.js';
import type { RigEditor } from './RigEditor.js';

/** React adapter. Slot/attachment selection belongs exclusively to RigEditorState. */
export class AttachmentController {
  private editor: RigEditor | undefined;
  private readonly listeners = new Set<() => void>();
  private snapshot = { editor: undefined as RigEditor | undefined, revision: 0, message: '' };
  private readonly releaseArtwork: (() => void) | undefined;
  constructor(readonly artwork?: ArtworkController) {
    this.releaseArtwork = artwork?.subscribe(() => this.refresh());
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  bind(editor: RigEditor): void {
    if (this.editor !== editor) this.snapshot = { ...this.snapshot, message: '' };
    this.editor = editor;
    this.artwork?.refreshTargets();
    this.refresh();
  }
  refresh(): void {
    this.snapshot = { ...this.snapshot, editor: this.editor, revision: this.snapshot.revision + 1 };
    for (const listener of this.listeners) listener();
  }
  private run(action: (editor: RigEditor) => void, message: string): void {
    const editor = this.editor;
    if (!editor) return;
    try {
      editor.cancelGesture();
      editor.state.endOperation();
      action(editor);
      this.snapshot = { ...this.snapshot, message };
    } catch (error) {
      this.snapshot = { ...this.snapshot, message: error instanceof Error ? error.message : String(error) };
    }
    this.refresh();
  }
  selectSlot(id: string): void {
    this.run((editor) => {
      editor.state.selectSlot(id);
      editor.refresh();
    }, 'Slot selected. Artwork alignment uses the same selection.');
  }
  selectSkin(name: string): void {
    this.run((editor) => editor.selectSkin(name), 'Skin preview updated.');
  }
  assign(id: string | null | undefined): void {
    this.run(
      (editor) => {
        const selection = editor.state.selection;
        if (selection?.type !== 'slot') throw new Error('Select a slot first.');
        editor.state.assignAttachment(selection.id, id);
        editor.refresh();
      },
      id === undefined
        ? 'Override removed. Default artwork restored.'
        : id === null
          ? 'Slot cleared.'
          : 'Attachment assigned.',
    );
  }
  createAttachment(id: string, texture: string, frame: string, numericFrame: boolean): void {
    this.run((editor) => {
      editor.state.createAttachment({
        id: id.trim(),
        texture,
        ...(frame === '' ? {} : { frame: numericFrame ? Number(frame) : frame }),
      });
      editor.refresh();
    }, 'Attachment created. Assign it to the selected slot to align its artwork.');
  }
  removeAttachment(id: string): void {
    this.run((editor) => {
      editor.state.removeAttachment(id);
      editor.refresh();
    }, 'Attachment definition removed.');
  }
  createSkin(name: string): void {
    this.run((editor) => {
      editor.state.createSkin(name.trim());
      editor.refresh();
    }, 'Empty partial skin created. Unspecified slots use the default skin.');
  }
  renameSkin(name: string): void {
    this.run((editor) => {
      editor.state.renameSkin(editor.state.activeSkin, name.trim());
      editor.refresh();
    }, 'Skin renamed.');
  }
  downloadSkin(): void {
    this.run((editor) => {
      const name = editor.state.activeSkin;
      const json = editor.state.exportSkinJson(name, false);
      downloadJson(json, `${name.replace(/[^a-zA-Z0-9._-]/g, '-')}.json`);
      editor.state.exportSkinJson(name);
      editor.refresh();
    }, 'Skin JSON downloaded. Replace its referenced skin file in the character folder.');
  }
  unbind(): void {
    this.editor = undefined;
    this.refresh();
  }
  dispose(): void {
    this.releaseArtwork?.();
    this.unbind();
    this.listeners.clear();
  }
}
