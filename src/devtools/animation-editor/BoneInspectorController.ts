import { type JointTransform, type TransformProperty, transformProperties } from '../../engine/types.js';
import { setAttribute, setText } from '../../shared/domUpdates.js';
import { boneHierarchy } from '../shared/boneHierarchy.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { type HierarchyEntry, navigateHierarchy, setHierarchyTabStop } from '../shared/hierarchyNavigation.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import { toDisplayTransformValue, toLocalTransformValue } from './transformValues.js';

const labels: Record<TransformProperty, string> = {
  x: 'X',
  y: 'Y',
  rotation: 'Rotation (°)',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
};
/** Stable numeric controls; temporary edits and animation mutation are owned by state. */
export class BoneInspectorController {
  private state: AnimationEditorState | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly abort = new AbortController();
  private hierarchyLifetime = new AbortController();
  private readonly hierarchy: HTMLElement;
  private readonly title: HTMLElement;
  private readonly fields: HTMLFieldSetElement;
  private readonly cancel: HTMLButtonElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly hierarchyEntries: HierarchyEntry[] = [];
  private selectedButton: HTMLButtonElement | undefined;
  private readonly rows = new Map<
    TransformProperty,
    {
      input: HTMLInputElement;
      indicator: HTMLElement;
      set: HTMLButtonElement;
      remove: HTMLButtonElement;
    }
  >();
  private bone: string | null | undefined;
  private time: number | undefined;
  private animation: ReadonlyAnimation | null | undefined;
  private draft: Readonly<Partial<JointTransform>> | undefined;
  private scrubbing: boolean | undefined;

  constructor(app: HTMLElement) {
    const element = <T extends HTMLElement>(selector: string): T => {
      const found = app.querySelector<T>(selector);
      if (!found) throw new Error(`Missing bone inspector element ${selector}.`);
      return found;
    };
    this.hierarchy = element('#animation-bones');
    this.title = element('#animation-bone-title');
    this.fields = element('#animation-bone-fields');
    this.cancel = element('#animation-cancel-transform');
    const options = { signal: this.abort.signal };
    for (const property of transformProperties) {
      const row = document.createElement('div');
      row.className = 'animation-property';
      const label = document.createElement('label');
      label.textContent = labels[property];
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.required = true;
      input.dataset.property = property;
      label.append(input);
      const indicator = document.createElement('span');
      indicator.className = 'key-indicator editor-sr-only';
      indicator.dataset.keyedProperty = property;
      const set = document.createElement('button');
      set.type = 'button';
      if (property === 'x') set.dataset.guideId = GUIDE_TARGETS.animationXKey;
      set.textContent = '◇';
      set.className = 'animation-key-button';
      set.setAttribute('aria-label', `Set ${labels[property]} key`);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Delete Key';
      remove.setAttribute('aria-label', `Delete ${labels[property]} key`);
      input.addEventListener('focus', () => this.state?.beginTransformEdit(), options);
      input.addEventListener(
        'input',
        () => {
          const value = input.valueAsNumber;
          if (input.validity.valid && Number.isFinite(value))
            this.state?.setTemporaryBoneProperty(property, toLocalTransformValue(property, value));
          this.render();
        },
        options,
      );
      set.addEventListener(
        'click',
        () => {
          if (!input.reportValidity()) return;
          this.state?.commitBoneProperty(property);
          this.render(true);
        },
        options,
      );
      remove.addEventListener(
        'click',
        () => {
          this.state?.deleteBonePropertyKey(property);
          this.render(true);
        },
        options,
      );
      const actions = document.createElement('details');
      actions.id = `animation-${property}-actions`;
      actions.className = 'animation-menu animation-property-actions';
      actions.setAttribute('data-workspace-menu', '');
      const summary = document.createElement('summary');
      summary.textContent = '⋯';
      summary.setAttribute('aria-label', `${labels[property]} key actions`);
      summary.title = `${labels[property]} key actions`;
      const content = document.createElement('div');
      content.className = 'animation-menu-content';
      content.append(remove);
      actions.append(summary, content);
      row.append(label, indicator, set, actions);
      this.fields.append(row);
      this.rows.set(property, { input, indicator, set, remove });
    }
    this.cancel.addEventListener(
      'click',
      () => {
        this.state?.cancelTransformEdit();
        this.render(true);
      },
      options,
    );
    this.fields.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.state?.cancelTransformEdit();
          this.render(true);
        }
      },
      options,
    );
    this.render();
  }

  bind(state: AnimationEditorState): void {
    this.unsubscribe?.();
    this.hierarchyLifetime.abort();
    this.hierarchyLifetime = new AbortController();
    this.state = state;
    this.bone = undefined;
    this.hierarchy.replaceChildren();
    this.buttons.clear();
    this.hierarchyEntries.length = 0;
    this.selectedButton = undefined;
    if (state.rig)
      for (const { id, depth } of boneHierarchy(state.rig)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tree-entry';
        button.textContent = id;
        button.style.paddingLeft = `${10 + depth * 16}px`;
        button.setAttribute('aria-pressed', 'false');
        this.hierarchyEntries.push({ button, level: depth + 1 });
        button.addEventListener('keydown', (event) => navigateHierarchy(event, button, this.hierarchyEntries), {
          signal: this.hierarchyLifetime.signal,
        });
        button.addEventListener('click', () => state.selectBone(state.selectedBoneId === id ? null : id), {
          signal: this.hierarchyLifetime.signal,
        });
        this.hierarchy.append(button);
        this.buttons.set(id, button);
      }
    setHierarchyTabStop(this.hierarchyEntries);
    this.unsubscribe = state.subscribe(() => this.render());
    this.render(true);
  }

  private render(force = false): void {
    const state = this.state;
    const transform = state?.selectedBoneTransform;
    const section = this.title.closest<HTMLElement>('#animation-bone-inspector');
    // This controller owns bone-panel visibility for every selection kind.
    if (section) section.hidden = !!state?.selectedIKConstraintId || !!state?.selectedEvent;
    const selectionEmpty = this.title
      .closest('.animation-selection-details')
      ?.querySelector<HTMLElement>('#animation-selection-empty');
    if (selectionEmpty) selectionEmpty.hidden = !state?.selectedIKConstraintId;
    const navigated =
      force ||
      this.bone !== state?.selectedBoneId ||
      this.time !== state?.currentTime ||
      this.animation !== state?.previewAnimation ||
      this.scrubbing !== state?.isScrubbing;
    const previousDraft = this.draft;
    this.draft = state?.boneTransformDraft;
    this.scrubbing = state?.isScrubbing;
    this.bone = state?.selectedBoneId;
    this.time = state?.currentTime;
    this.animation = state?.previewAnimation;
    setText(this.title, this.bone ? `Bone: ${this.bone}` : 'Select a bone');
    if (this.fields.disabled !== !transform) this.fields.disabled = !transform;
    this.fields.hidden = !transform;
    this.cancel.hidden = !transform;
    const empty = section?.querySelector<HTMLElement>('#animation-bone-empty');
    if (empty) empty.hidden = !!transform;
    const help = section?.querySelector<HTMLElement>('.animation-field-help');
    if (help) help.hidden = !transform;
    const selected = this.bone ? this.buttons.get(this.bone) : undefined;
    if (selected !== this.selectedButton) {
      if (this.selectedButton) setAttribute(this.selectedButton, 'aria-pressed', 'false');
      if (selected) setAttribute(selected, 'aria-pressed', 'true');
      setHierarchyTabStop(this.hierarchyEntries, selected);
      this.selectedButton = selected;
    }
    for (const [property, { input, indicator, set, remove }] of this.rows) {
      const cancelled = previousDraft?.[property] !== undefined && this.draft?.[property] === undefined;
      if (navigated || cancelled || document.activeElement !== input) {
        const value = transform
          ? String(Number(toDisplayTransformValue(property, transform[property]).toFixed(6)))
          : '';
        if (input.value !== value) input.value = value;
      }
      const keyed = !!this.bone && !!state?.hasKeyframeAtTime(this.bone, property);
      setText(set, keyed ? '◆' : '◇');
      setAttribute(set, 'data-keyed', String(keyed));
      setAttribute(set, 'title', `${keyed ? 'Update' : 'Set'} ${labels[property]} key at the playhead`);
      setText(indicator, keyed ? '● keyed' : '○ no key');
      setAttribute(indicator, 'data-keyed', String(keyed));
      setAttribute(input, 'data-temporary', String(state?.boneTransformDraft[property] !== undefined));
      const setDisabled = !transform || !input.validity.valid;
      if (set.disabled !== setDisabled) set.disabled = setDisabled;
      if (remove.disabled !== !keyed) remove.disabled = !keyed;
    }
    const cancelDisabled =
      !transform ||
      (!state?.hasTemporaryTransform && ![...this.rows.values()].some(({ input }) => !input.validity.valid));
    if (this.cancel.disabled !== cancelDisabled) this.cancel.disabled = cancelDisabled;
  }

  /** A failed/replaced scene must release the previous rig and its selectable hierarchy. */
  unbind(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.hierarchyLifetime.abort();
    this.state = undefined;
    this.hierarchy.replaceChildren();
    this.buttons.clear();
    this.hierarchyEntries.length = 0;
    this.selectedButton = undefined;
    this.render(true);
  }

  dispose(): void {
    this.unbind();
    this.abort.abort();
    this.rows.clear();
  }
}
