import { GUIDE_TARGETS as T } from './anchors.js';
import type { GuideDefinition, GuideStep } from './types.js';

const step = (id: string, title: string, targetId: string, description: string): GuideStep => ({
  id,
  title,
  targetId,
  description,
  preparation: 'reveal-target',
});

export const projectGuides: readonly GuideDefinition[] = [
  {
    id: 'project-audio-assets',
    title: 'Importing and Managing Audio',
    description:
      'Import music, ambience, sound effects and voices, audition them and keep their binaries in project saves.',
    editor: 'project',
    category: 'audio',
    prerequisites: [
      {
        capability: 'tool:project',
        reason: 'Open Project Workspace, then create or import a project. No character or scene is required.',
      },
    ],
    steps: [
      step(
        'library',
        'Open the Audio library',
        T.projectAudio,
        '**Audio** belongs to this project, alongside its characters and scenes. Expand Audio to see the library. This tour reveals controls only: it does not import, rename, remove or play anything. You can follow it in an empty project; exit or finish the tour before trying the controls.',
      ),
      step(
        'import',
        'Import a supported audio file',
        T.projectAudioImport,
        'After exiting, choose an **Import category** and click **Import Audio**. WAV, MP3 and OGG are accepted when this browser can decode their contents. Files must be nonempty and at most **10 MiB** each. An extension or MIME type alone is not enough. If decoding fails, export a compatible encoding such as PCM WAV and retry. Filename collisions get separate paths; import never starts sound.',
      ),
      step(
        'categories',
        'Organize music, ambience, effects and voices',
        T.projectAudioCategories,
        '**Music**, **Ambience**, **Sound effects** and **Voice** are organizational categories with one shared playback backend. Each category starts collapsed and shows its count. Open one to see its asset rows, file paths and available duration. The Category selector on a row moves that asset while preserving its stable ID and binary path.',
      ),
      step(
        'preview',
        'Audition with Play, Stop and volume',
        T.projectAudioPreview,
        'After exiting, click **Play** on an audio row. Its button changes to **Stop** while loading or playing; click Stop on that same row to end the preview. Names are labels and do not play sound. Only one asset auditions at a time. Stop preview at the top also stops sound or cancels a pending Play; **Preview volume** changes audition loudness. Sound requires an explicit click and browser permission. Closing a category stops its preview; closing Audio releases decoded resources. Import and this tour never start playback. Scene audio timeline placement comes later.',
      ),
      step(
        'manage',
        'Rename or remove an audio asset',
        T.projectAudioCategories,
        'Use **Rename**, enter an Audio name and choose **Apply name**, then Done. Display names can change without breaking stable IDs or paths. **Remove** takes an asset out of the library; **Undo Project** restores its original bytes. Assets with registered dependents must have those references removed first. Scene audio references are deferred to the timeline milestone.',
      ),
      step(
        'history',
        'Undo project audio changes',
        T.projectHistory,
        'Import, rename, category changes and removal use **Undo Project** and **Redo Project**. Audition, volume and guide progress are view state and do not create history entries. Finish or exit this tour before using history. The guide itself leaves authored project data and editing checkpoints unchanged.',
      ),
      step(
        'save',
        'Keep audio in portable project saves',
        T.projectExport,
        '**Export Project** downloads a portable ZIP containing audio metadata and original binary files. **Import Project** restores those IDs, categories, names and paths and checks browser codec support. Committed edits also use the existing browser autosave and recovery; inspect **Local draft** for save status. Decoded buffers and preview settings are not saved. A download does not overwrite repository files. Scene timeline authoring and playback synchronization remain deferred to v1.3.2.',
      ),
    ],
  },
];
