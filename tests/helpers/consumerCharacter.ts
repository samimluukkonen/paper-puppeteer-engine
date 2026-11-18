import { readFileSync } from 'node:fs';
import { AnimationEditorState } from '../../src/devtools/animation-editor/AnimationEditorState.js';
import { RigEditorState } from '../../src/devtools/rig-editor/RigEditorState.js';
import type { PackageSnapshot } from '../../src/devtools/shared/package/characterPackage.js';
import { type AnimationClip, commitIKBake, generateBakedBoneKeys, sampleIKBake } from '../../src/engine/core.js';
import { Rig } from '../../src/engine/Rig.js';
import { demoCharacter } from './demoCharacter.js';

/** Finite action/queue clips and a looping locomotion state for runtime integration tests. */
export const controllerAnimations: readonly AnimationClip[] = [
  {
    name: 'attack',
    duration: 400,
    loop: false,
    tracks: {
      rightUpperArm: [
        { time: 0, rotation: -0.4 },
        { time: 200, rotation: -1.6 },
        { time: 400, rotation: -0.7 },
      ],
    },
    events: [{ time: 200, name: 'attack-hit' }],
  },
  {
    name: 'recover',
    duration: 300,
    loop: false,
    tracks: {
      rightUpperArm: [
        { time: 0, rotation: -0.7 },
        { time: 300, rotation: 0 },
      ],
    },
    events: [{ time: 300, name: 'recovered' }],
  },
  {
    name: 'run',
    duration: 500,
    loop: true,
    tracks: {
      leftThigh: [
        { time: 0, rotation: -0.5 },
        { time: 250, rotation: 0.5 },
        { time: 500, rotation: -0.5 },
      ],
      rightThigh: [
        { time: 0, rotation: 0.5 },
        { time: 250, rotation: -0.5 },
        { time: 500, rotation: 0.5 },
      ],
    },
    events: [{ time: 250, name: 'run-footstep' }],
  },
];

/** Representative editor-authored snapshot used by runtime integration tests. */
export function consumerCharacter(): PackageSnapshot {
  const rig = new RigEditorState(new Rig(demoCharacter.rig, []), structuredClone(demoCharacter.rigFile!), {
    defaultSkin: demoCharacter.defaultSkin,
    standaloneSkins: demoCharacter.standaloneSkins,
  });
  const animations = new AnimationEditorState(demoCharacter.rig, demoCharacter.animations);
  animations.selectAnimation('idle');
  animations.keyframes.setBonePropertyKeyframe('torso', 'rotation', 0.12, 0.5);
  const chain = demoCharacter.rig.ik![0]!;
  const reach: AnimationClip = {
    name: 'reach',
    duration: 1000,
    loop: true,
    tracks: {},
    ikTracks: {
      [chain.name]: [
        { time: 0, x: -90, y: -50, mix: 1 },
        { time: 1000, x: -80, y: -30, mix: 0.8 },
      ],
    },
    events: [{ time: 500, name: 'reach-marker', data: { hand: chain.endBone } }],
  };
  const sampling = sampleIKBake(reach, demoCharacter.rig, [chain.name], { fps: 24 });
  if (!sampling.success) throw new Error('Consumer fixture IK sampling failed.');
  const proposal = generateBakedBoneKeys(sampling, demoCharacter.rig, { animation: reach });
  if (!proposal.success) throw new Error('Consumer fixture IK key generation failed.');
  const baked = commitIKBake(reach, proposal, demoCharacter.rig);
  if (!baked.success) throw new Error('Consumer fixture IK bake failed.');
  return {
    definition: demoCharacter,
    rig: structuredClone(rig.recoveryDraft),
    skins: demoCharacter.standaloneSkins,
    animations: [
      ...animations.packageAnimations(),
      reach,
      { ...baked.animation, name: 'baked' },
      ...controllerAnimations,
    ],
    replacements: [
      {
        assetKey: 'paper-head',
        reference: undefined,
        blob: new Blob([
          readFileSync(new URL('../../public/characters/demo-puppet/images/paper-helmet-head.png', import.meta.url)),
        ]),
        format: 'image/png',
        originScaleX: 1,
        originScaleY: 1,
      },
    ],
  };
}

export const consumerImageFetcher: typeof fetch = (input) => {
  const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return Promise.resolve(
    new Response(readFileSync(new URL(`../../public/characters/demo-puppet/${path}`, import.meta.url))),
  );
};
