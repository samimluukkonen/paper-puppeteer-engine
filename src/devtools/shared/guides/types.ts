import type { WorkspaceView } from '../WorkspaceNavigation.js';

export type GuideEditor = WorkspaceView | 'scene' | 'project';
export type GuideCategory = 'rigging' | 'artwork' | 'animation' | 'ik' | 'scene' | 'audio';
export type GuideTargetId = string;
export type GuideCapability =
  | 'character'
  | 'valid-rig'
  | 'animation'
  | 'bone-keyframes'
  | 'ik-keyframes'
  | 'ik-constraints'
  | 'rig-artwork'
  | 'rig-mesh-artwork'
  | 'mesh-attachments'
  | 'selected-bone'
  | 'onion-enabled'
  | 'selected-x-key'
  | `tool:${string}`;

/** Facts only: never pass editor documents, commands, playback, or history to a guide. */
export interface GuideContext {
  readonly editor: GuideEditor;
  readonly capabilities: readonly GuideCapability[];
}

export interface GuidePrerequisite {
  readonly capability: GuideCapability;
  readonly reason: string;
  readonly guideId?: string;
}

export type GuideInteraction =
  | { readonly mode?: 'explain' }
  | {
      readonly mode: 'try-it';
      readonly practice: {
        readonly targetId: GuideTargetId;
        /** Plain text with optional **keyword** emphasis. */
        readonly instruction: string;
        readonly changesProject: boolean;
        readonly prerequisites?: readonly GuidePrerequisite[];
        readonly completion?: { readonly capability: GuideCapability; readonly message: string };
      };
    };

export type GuideStep = GuideInteraction & {
  readonly id: string;
  readonly title: string;
  /** Plain text with optional **keyword** emphasis; no HTML or general Markdown. */
  readonly description: string;
  readonly targetId: GuideTargetId;
  readonly prerequisites?: readonly GuidePrerequisite[];
  /** UI-only reveal hint, never an authored command. The spotlight may also reveal missing targets. */
  readonly preparation?: 'reveal-target';
};

export interface GuideDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly editor: GuideEditor;
  readonly category: GuideCategory;
  readonly prerequisites?: readonly GuidePrerequisite[];
  readonly steps: readonly GuideStep[];
}

export type GuideAvailability = { readonly available: true } | { readonly available: false; readonly reason: string };
export type GuideCommandResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Viewport CSS pixels, matching getBoundingClientRect (not Phaser world coordinates or device pixels). */
export interface GuideRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GuideTargetResolver {
  resolve(targetId: GuideTargetId): GuideRectangle | null;
  /** Real control identity, including while hidden. Interaction must recheck visibility. Geometry alone grants no access. */
  resolveElement?(targetId: GuideTargetId): Element | null;
  /** May reveal a panel/tab or scroll. Must never select/edit data or invoke an editor action. */
  reveal(targetId: GuideTargetId): boolean;
}
