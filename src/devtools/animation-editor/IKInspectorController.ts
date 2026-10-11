import { ikAnimationProperties, type IKAnimationProperty } from '../../engine/ik/animationKeyframes.js';
import type { AnimationEditorState } from './AnimationEditorState.js';

export interface IKInspectorField {
  readonly property: IKAnimationProperty;
  readonly text: string;
  readonly keyed: boolean;
  readonly temporary: boolean;
  readonly valid: boolean;
}
export interface IKInspectorSnapshot {
  readonly constraintId: string | null;
  readonly ready: boolean;
  readonly fields: readonly IKInspectorField[];
}

/** React adapter: cached snapshots and text drafts, with authored data/clock owned by the editor. */
export class IKInspectorController {
  private state: AnimationEditorState | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly text = new Map<IKAnimationProperty, string>();
  private previousDraft: Readonly<Partial<Record<IKAnimationProperty, number>>> = {};
  private context: readonly unknown[] = [];
  private snapshot: IKInspectorSnapshot = Object.freeze({
    constraintId: null,
    ready: false,
    fields: Object.freeze([]),
  });

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): IKInspectorSnapshot => this.snapshot;

  bind(state: AnimationEditorState): void {
    this.unsubscribe?.();
    this.state = state;
    this.text.clear();
    this.context = [];
    this.unsubscribe = state.subscribe(() => this.refresh());
    this.refresh();
  }
  unbind(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.state = undefined;
    this.text.clear();
    this.context = [];
    this.refresh();
  }
  beginEdit(): void {
    this.state?.beginIKEdit();
  }
  edit(property: IKAnimationProperty, text: string): void {
    this.text.set(property, text);
    const value = this.valid(property, text) ? Number(text) : this.state?.selectedIKTargetValues?.[property];
    if (value !== undefined) this.state?.setTemporaryIKProperty(property, value);
    this.refresh();
  }
  commit(property: IKAnimationProperty): boolean {
    const field = this.snapshot.fields.find((entry) => entry.property === property);
    if (!field?.valid || !this.state) return false;
    // Install the current text even if its number matches the previous evaluated value.
    if (!this.state.setTemporaryIKProperty(property, Number(field.text))) return false;
    const result = this.state.commitIKProperty(property);
    if (result) this.text.delete(property);
    this.refresh();
    return result;
  }
  remove(property: IKAnimationProperty): boolean {
    const result = this.state?.deleteIKPropertyKey(property) ?? false;
    if (result) this.text.delete(property);
    this.refresh();
    return result;
  }
  cancel(): void {
    this.text.clear();
    this.state?.cancelIKEdit();
    this.refresh();
  }
  private valid(property: IKAnimationProperty, text: string): boolean {
    const value = Number(text);
    return text.trim() !== '' && Number.isFinite(value) && (property !== 'mix' || (value >= 0 && value <= 1));
  }
  private refresh(): void {
    const state = this.state;
    const context = [state, state?.selectedTarget, state?.currentTime, state?.workingAnimation, state?.sessionRevision];
    if (context.some((value, index) => value !== this.context[index])) this.text.clear();
    for (const property of ikAnimationProperties) {
      if (this.previousDraft[property] !== undefined && state?.ikTargetDraft[property] === undefined)
        this.text.delete(property);
    }
    this.previousDraft = state?.ikTargetDraft ?? {};
    this.context = context;
    const values = state?.selectedIKTargetValues;
    const id = state?.selectedIKConstraintId ?? null;
    const snapshot: IKInspectorSnapshot = Object.freeze({
      constraintId: id,
      ready: !!values,
      fields: Object.freeze(
        values
          ? ikAnimationProperties.map((property) => {
              const text = this.text.get(property) ?? String(Number(values[property].toFixed(6)));
              return Object.freeze({
                property,
                text,
                keyed: !!id && !!state?.findIKPropertyKeyframe(id, property),
                temporary: state?.ikTargetDraft[property] !== undefined || this.text.has(property),
                valid: this.valid(property, text),
              });
            })
          : [],
      ),
    });
    if (JSON.stringify(snapshot) === JSON.stringify(this.snapshot)) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
  dispose(): void {
    this.unbind();
    this.listeners.clear();
  }
}
