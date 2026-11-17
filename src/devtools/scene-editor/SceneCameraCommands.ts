import {
  CAMERA_PROPERTIES,
  evaluateCameraAtTime,
  type CameraProperty,
  type CameraKeyframe,
} from '../../engine/core.js';
import type { CinematicCameraState } from '../../engine/data.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';
import type { SceneGestureKind } from './SceneEditorGestures.js';

type CommandState = Pick<
  SceneEditorDocument,
  'cinematicCamera' | 'replaceScene' | 'selectCameraKey' | 'setCameraKeyEditing' | 'workingScene'
>;
/** The camera-key edits a scene document exposes as `document.camera`. */
export type SceneCameraEditing = Pick<SceneCameraCommands, keyof SceneCameraCommands>;

/** Build camera-key and cut proposals; the document validates and commits each snapshot to its shared history. */
export class SceneCameraCommands {
  constructor(
    private readonly state: CommandState,
    /** Commit the active gesture, unless it is a drag of `unlessDragging`. */
    private readonly finishGestures: (unlessDragging?: SceneGestureKind) => void,
    /** The playback time camera keys default to. */
    private readonly time: () => number,
  ) {}

  /** Explicit capture; channels at the same time are replaced without duplicating keys. */
  setCameraKey(time = this.time(), values: Partial<CinematicCameraState> = this.state.cinematicCamera): boolean {
    this.finishGestures('camera');
    const scene = this.state.workingScene;
    if (!scene) return false;
    const tracks = { ...scene.cameraTracks };
    for (const property of CAMERA_PROPERTIES) {
      if (values[property] === undefined) continue;
      const keys = tracks[property] ?? [];
      const existing = keys.find((key) => Math.abs(key.time - time) < 1e-6);
      let index = 1;
      while (keys.some((key) => key.id === `camera-key-${index}`)) index++;
      const next = { ...existing, id: existing?.id ?? `camera-key-${index}`, time, value: values[property] };
      tracks[property] = [...keys.filter((key) => key !== existing), next].sort((a, b) => a.time - b.time);
    }
    return this.state.replaceScene({ ...scene, cameraTracks: tracks });
  }
  /** A cut uses the existing camera owner: each preceding channel key holds until
   * this shot's key. A time-zero baseline prevents first-key pre-roll changing the old shot.
   * All three channels and predecessor curves enter history in one validated snapshot.
   */
  setCameraCut(time = this.time(), values: CinematicCameraState = this.state.cinematicCamera): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene) return false;
    const tracks = { ...scene.cameraTracks };
    for (const property of CAMERA_PROPERTIES) {
      let keys = [...(tracks[property] ?? [])];
      const nextId = (): string => {
        let index = 1;
        while (keys.some((key) => key.id === `camera-key-${index}`)) index++;
        return `camera-key-${index}`;
      };
      if (time > 0 && !keys.some((key) => key.time < time))
        keys.push({ id: nextId(), time: 0, value: evaluateCameraAtTime(scene, 0)[property] });
      const existing = keys.find((key) => key.time === time);
      const shot = { ...existing, id: existing?.id ?? nextId(), time, value: values[property] };
      keys = [...keys.filter((key) => key.time !== time), shot].sort((a, b) => a.time - b.time);
      let before = -1;
      for (let index = 0; index < keys.length; index++) if (keys[index]!.time < time) before = index;
      if (before >= 0) keys[before] = { ...keys[before]!, curve: { mode: 'stepped' } };
      tracks[property] = keys;
    }
    if (!this.state.replaceScene({ ...scene, cameraTracks: tracks })) return false;
    this.state.setCameraKeyEditing(true);
    return true;
  }
  updateCameraKey(property: CameraProperty, id: string, patch: Partial<Omit<CameraKeyframe, 'id'>>): boolean {
    this.finishGestures('cameraKey');
    const scene = this.state.workingScene;
    const keys = scene?.cameraTracks?.[property];
    if (!scene || !keys?.some((key) => key.id === id)) return false;
    return this.state.replaceScene({
      ...scene,
      cameraTracks: {
        ...scene.cameraTracks,
        [property]: keys.map((key) => (key.id === id ? { ...key, ...patch } : key)).sort((a, b) => a.time - b.time),
      },
    });
  }
  removeCameraKey(property: CameraProperty, id: string): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene?.cameraTracks?.[property]?.some((key) => key.id === id)) return false;
    return this.state.replaceScene({
      ...scene,
      cameraTracks: { ...scene.cameraTracks, [property]: scene.cameraTracks[property].filter((key) => key.id !== id) },
    });
  }
  duplicateCameraKey(property: CameraProperty, id: string, time: number): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    const keys = scene?.cameraTracks?.[property];
    const key = keys?.find((key) => key.id === id);
    if (!scene || !key || !keys) return false;
    let index = 1;
    while (keys.some((key) => key.id === `camera-key-${index}`)) index++;
    const next = { ...key, id: `camera-key-${index}`, time };
    const result = this.state.replaceScene({
      ...scene,
      cameraTracks: { ...scene.cameraTracks, [property]: [...keys, next].sort((a, b) => a.time - b.time) },
    });
    if (result) this.state.selectCameraKey(property, next.id);
    return result;
  }
}
