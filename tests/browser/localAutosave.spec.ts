import { readFile } from 'node:fs/promises';
import { expect, type Frame, type Page } from '@playwright/test';
import type { LocalDraftStore } from '../../src/devtools/shared/autosave/LocalDraftStore.js';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { sceneTimelineGroup, inspectorControl, test } from './fixtures.js';

declare global {
  interface Window {
    localDraftTest: LocalDraftStore;
  }
}

async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Project', exact: true });
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByRole('button', { name: 'Create Project', exact: true }).click();
}
async function activeEditor(page: Page): Promise<Frame> {
  const element = await page.locator('iframe:visible').elementHandle();
  const frame = await element?.contentFrame();
  if (!frame) throw new Error('No active editor frame.');
  await expect(frame.locator('#validation')).toHaveText('Validation: OK');
  return frame;
}
async function reveal(frame: Frame, selector: string) {
  return inspectorControl(frame, selector);
}
const saved = (page: Page) => expect(page.getByLabel('Local save status')).toContainText('Local draft saved');

test('refresh recovers artwork, committed rig, animation and scene edits then exports and imports the exact project', async ({
  page,
}) => {
  await page.goto('project/');
  await createProject(page, 'Recovery Film');
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const character = page.getByRole('dialog', { name: 'New Character', exact: true });
  await character.getByLabel('Character name').fill('Hero');
  await character.getByRole('button', { name: 'Create Character', exact: true }).click();
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  const frame = await activeEditor(page);
  const artwork = frame.locator('#editor-app #artwork-panel');
  await inspectorControl(frame, '#editor-app #artwork-panel');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ac2345';
    context.fillRect(0, 0, 8, 8);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await artwork.getByLabel('Import new artwork', { exact: true }).setInputFiles({
    name: 'guardian.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(artwork).toContainText('Artwork added to the library.');
  await reveal(frame, '#hierarchy');
  const root = frame.getByRole('treeitem', { name: 'root', exact: true });
  if ((await root.getAttribute('aria-selected')) !== 'true') await root.click();
  const x = await reveal(frame, '#inspector [data-scope=bone][data-field=x]');
  await x.fill('42');
  await x.blur();
  await frame.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await frame.getByRole('button', { name: '+ New Animation', exact: true }).click();
  const animation = frame.getByRole('dialog', { name: 'Create new animation', exact: true });
  await animation.getByLabel('Animation name / ID').fill('wave');
  await animation.getByRole('button', { name: 'Create Animation', exact: true }).click();
  await reveal(frame, '#animation-bones');
  const bone = frame.locator('#animation-bones').getByRole('button', { name: 'root', exact: true });
  if ((await bone.getAttribute('aria-pressed')) !== 'true') await bone.click();
  await (await reveal(frame, '#animation-bone-fields input[data-property=x]')).fill('17');
  await frame.getByRole('button', { name: 'Set X key', exact: true }).click();
  await saved(page);
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  await page.getByRole('button', { name: '+ New Scene', exact: true }).click();
  const scene = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await scene.getByLabel('Scene name').fill('Opening');
  await scene.getByRole('button', { name: 'Create Scene', exact: true }).click();
  await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  const sceneFrame = await (await page.locator('iframe:visible').elementHandle())?.contentFrame();
  if (!sceneFrame) throw new Error('No scene editor frame.');
  await (await inspectorControl(sceneFrame, '[data-guide-id="scene-add-actor"]')).click();
  await sceneFrame
    .getByRole('dialog', { name: 'Add Actor', exact: true })
    .getByRole('button', { name: 'Add actor', exact: true })
    .click();
  await sceneTimelineGroup(sceneFrame, 'Actions');
  await sceneFrame.getByRole('combobox', { name: 'Action type', exact: true }).selectOption('wait');
  await sceneFrame.getByRole('button', { name: 'Add action', exact: true }).click();
  await sceneFrame.getByText('Action properties · wait', { exact: true }).click();
  await sceneFrame.getByLabel('Action duration (seconds)', { exact: true }).fill('0.75');
  await sceneFrame.getByRole('button', { name: 'Apply action properties' }).click();
  await saved(page);
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.reload();
  const recovery = page.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
  await expect(recovery).toBeVisible();
  await expect(recovery.locator('time')).toHaveAttribute('datetime', /\d{4}-/);
  await recovery.getByRole('button', { name: 'Recover Draft', exact: true }).click();
  await expect(recovery).not.toBeVisible();
  await expect(page.getByText('Project metadata: Unsaved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  const restored = await activeEditor(page);
  await reveal(restored, '#hierarchy');
  const restoredRoot = restored.getByRole('treeitem', { name: 'root', exact: true });
  if ((await restoredRoot.getAttribute('aria-selected')) !== 'true') await restoredRoot.click();
  await expect(await reveal(restored, '#inspector [data-scope=bone][data-field=x]')).toHaveValue('42');
  await restored.getByRole('button', { name: '← Project', exact: true }).click();
  const library = page.locator('.project-asset-library').first();
  await library.locator(':scope > summary').click();
  await library
    .locator('.project-asset-group')
    .filter({ has: page.locator('summary', { hasText: /^Animations/ }) })
    .locator(':scope > summary')
    .click();
  await expect(library.getByText('wave', { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const bytes = await readFile(await (await downloading).path());
  const files = decodePackageZip(new Uint8Array(bytes));
  expect(Buffer.from(files.get('assets/image-1.png')!)).toEqual(Buffer.from(png, 'base64'));
  const sceneBytes = files.get('scenes/scene-1.json')!;
  expect(parseSceneJson(new TextDecoder().decode(sceneBytes)).actions[0]).toMatchObject({
    type: 'wait',
    duration: 750,
  });
  const clipBytes = files.get('characters/character-1/animations/wave.json')!;
  expect(animationFileSchema.parse(JSON.parse(new TextDecoder().decode(clipBytes))).tracks.root?.[0]?.x).toBe(17);
  await expect(page.getByLabel('Local save status')).toContainText('Explicitly exported');
  await page
    .getByLabel('Import Project', { exact: true })
    .setInputFiles({ name: 'film.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(page.getByText('Project metadata: Exported', { exact: true })).toBeVisible();
});

test('recovery cancellation preserves data and explicit discard removes it', async ({ page }) => {
  await page.goto('project/');
  await createProject(page, 'Discard Film');
  await saved(page);
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'Local draft', exact: true }).click();
  await page.getByRole('button', { name: 'Recovery drafts', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Discard Draft', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(dialog).not.toBeVisible();
});

test('accepting recovery in a standalone editor restores the project after navigation with one confirmation', async ({
  page,
}) => {
  await page.goto('project/');
  await createProject(page, 'One Confirmation Film');
  await saved(page);
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await expect(page).toHaveURL(/rig-editor\//);
  const dialog = page.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Recover Draft', exact: true }).click();
  await expect(page).toHaveURL(/project\/\?recover=/);
  await expect(page.getByRole('heading', { name: 'One Confirmation Film', exact: true })).toBeVisible();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Project metadata: Unsaved', { exact: true })).toBeVisible();
  // The intent is consumed once; a later independent startup offers recovery normally.
  await saved(page);
  await page.reload();
  await expect(dialog).toBeVisible();
});

test('corrupt newest binary snapshot leaves the previous complete project recoverable through the dialog', async ({
  page,
}) => {
  await page.goto('project/');
  await createProject(page, 'Last Valid Film');
  await saved(page);
  await page.getByText('Project Settings', { exact: true }).click();
  await page.getByRole('main').getByLabel('Project name', { exact: true }).fill('Newest Film');
  await page.getByRole('button', { name: 'Apply name', exact: true }).click();
  await saved(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('paper-puppeteer-recovery', 2);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['revisions', 'binaries'], 'readwrite');
        const store = tx.objectStore('revisions');
        const request = store.getAll();
        request.onsuccess = () => {
          // Damage the changed project document while preserving its digest and
          // the previous revision's independently addressed document.
          const records = request.result as {
            id: string;
            savedAt: number;
            files: { path: string; digest: string }[];
          }[];
          if (records.length !== 2) {
            tx.abort();
            return;
          }
          const latest = records.sort((a, b) => b.savedAt - a.savedAt)[0]!;
          tx.objectStore('binaries').put(
            new Blob(['corrupt']),
            latest.files.find((file) => file.path === 'project.json')!.digest,
          );
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('Expected two retained snapshots.'));
      });
    } finally {
      db.close();
    }
  });
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
  await dialog.getByRole('button', { name: 'Recover Draft', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Corrupt local resource');
  await expect(dialog.getByLabel('Project / revision').locator('option')).toHaveCount(2);
  await dialog.getByLabel('Project / revision').selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Recover Draft', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Last Valid Film', exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const files = decodePackageZip(await readFile(await (await downloading).path()));
  expect(files.has('project.json')).toBe(true);
});

test('a second browser tab cannot recover over a live writer and can recover after it leaves', async ({ page }) => {
  await page.goto('project/');
  await createProject(page, 'Shared Film');
  await saved(page);
  const other = await page.context().newPage();
  try {
    await other.goto(page.url());
    const dialog = other.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
    await dialog.getByRole('button', { name: 'Recover Draft', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Another tab');
    page.on('dialog', (native) => {
      void native.accept();
    });
    await page.goto('scene-editor/');
    await dialog.getByRole('button', { name: 'Recover Draft', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(other.getByRole('heading', { name: 'Shared Film', exact: true })).toBeVisible();
  } finally {
    await other.close();
  }
});

test('IndexedDB transactions retain two revisions, detect conflicts/corruption/versions and survive interrupted writes', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'development', 'Direct module harness uses the local Vite source server.');
  await page.goto('project/');
  await page.addScriptTag({
    type: 'module',
    content: `import { LocalDraftStore } from '/src/devtools/shared/autosave/LocalDraftStore.ts'; window.localDraftTest = new LocalDraftStore();`,
  });
  await page.waitForFunction(() => !!window.localDraftTest);
  const results = await page.evaluate(async () => {
    const store = window.localDraftTest;
    const files = new Map([
      ['project.json', new TextEncoder().encode('{}')],
      ['image.png', new Uint8Array([1, 2, 3])],
    ]);
    const error = async (task: () => Promise<unknown>) => {
      try {
        await task();
        return '';
      } catch (e) {
        return String(e);
      }
    };
    await store.save('film', 'tab1', 'Film', '1', files);
    await store.save('film', 'tab1', 'Film', '2', files);
    await store.save('film', 'tab1', 'Film', '3', files);
    const entries = await store.list();
    const conflict = await error(() => store.save('film', 'tab2', 'Film', 'foreign', files));
    // oxlint-disable-next-line typescript/unbound-method -- Deliberately borrowed and invoked with its original store receiver.
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
      const result = original.call(this, value, key);
      this.transaction.abort();
      return result;
    };
    const interrupted = await error(() => store.save('film', 'tab1', 'Film', '4', files));
    IDBObjectStore.prototype.add = original;
    IDBObjectStore.prototype.add = function () {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    };
    const quota = await error(() => store.save('film', 'tab1', 'Film', 'quota', files));
    IDBObjectStore.prototype.add = original;
    const intact = await store.list();
    const oldFiles = await store.read(entries[0]!.id);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('paper-puppeteer-recovery', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const mutate = (id: string, version: number, savedAt = Date.now()) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction('revisions', 'readwrite');
        const drafts = tx.objectStore('revisions');
        const get = drafts.get(id);
        get.onsuccess = () => {
          const value: unknown = get.result;
          if (typeof value !== 'object' || value === null) throw new Error('Missing draft');
          drafts.put({ ...value, id, version, savedAt, files: [{ path: 'image.png', digest: 'bad' }] });
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    await mutate(entries[0]!.id, 99);
    const incompatible = await error(() => store.read(entries[0]!.id));
    await mutate(entries[0]!.id, 2, Number.MAX_VALUE);
    const corruptTime = (await store.list()).find((entry) => entry.id === entries[0]!.id)?.savedAt;
    const corrupt = await error(() => store.read(entries[0]!.id));
    const previous = await store.read(entries[1]!.id);
    await store.release('film', 'tab1');
    await store.claim('film', 'tab2');
    await store.discard('film', 'tab2');
    for (let index = 0; index < 10; index++) await store.save(`project-${index}`, 'tab1', 'Film', '1', files);
    const capacity = await error(() => store.save('overflow', 'tab1', 'Film', '1', files));
    const full = (await store.list()).length;
    await store.discard('project-0', 'tab1');
    await store.save('overflow', 'tab1', 'Film', '1', files);
    for (const key of new Set((await store.list()).map((entry) => entry.key))) await store.discard(key, 'tab1');
    db.close();
    return {
      count: entries.length,
      intact: intact.length,
      conflict,
      interrupted,
      quota,
      corruptTime,
      capacity,
      full,
      incompatible,
      corrupt,
      bytes: [...oldFiles.get('image.png')!],
      previous: previous.size,
      remaining: (await store.list()).length,
    };
  });
  expect(results).toMatchObject({
    count: 2,
    intact: 2,
    bytes: [1, 2, 3],
    previous: 2,
    remaining: 0,
    corruptTime: 0,
    full: 10,
  });
  expect(results.capacity).toContain('Local recovery holds 10 projects');
  expect(results.conflict).toContain('Another tab');
  expect(results.interrupted).toBeTruthy();
  expect(results.quota).toContain('QuotaExceededError');
  expect(results.incompatible).toContain('Unsupported local snapshot version');
  expect(results.corrupt).toContain('Corrupt local snapshot');
});

test('draft persistence reuses hashes and binaries, reads metadata only and collects the last reference', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'development', 'Direct module harness uses the local Vite source server.');
  await page.goto('project/');
  await page.addScriptTag({
    type: 'module',
    content: `import { LocalDraftStore } from '/src/devtools/shared/autosave/LocalDraftStore.ts'; window.localDraftTest = new LocalDraftStore();`,
  });
  await page.waitForFunction(() => !!window.localDraftTest);
  const result = await page.evaluate(async () => {
    const store = window.localDraftTest;
    const image = new Uint8Array([1, 2, 3]);
    const files = new Map([
      ['project.json', new TextEncoder().encode('{}')],
      ['image.png', image],
      ['alias.png', image],
    ]);
    const reads: string[] = [];
    let hashes = 0;
    let writes = 0;
    // oxlint-disable-next-line typescript/unbound-method -- Called with the original receiver below.
    const originalDigest = crypto.subtle.digest;
    // oxlint-disable-next-line typescript/unbound-method -- Called with the original receiver below.
    const originalAdd = IDBObjectStore.prototype.add;
    // oxlint-disable-next-line typescript/unbound-method -- Called with the original receiver below.
    const originalGet = IDBObjectStore.prototype.get;
    // oxlint-disable-next-line typescript/unbound-method -- Called with the original receiver below.
    const originalGetAll = IDBObjectStore.prototype.getAll;
    crypto.subtle.digest = function (algorithm, data) {
      hashes++;
      return originalDigest.call(this, algorithm, data);
    };
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'binaries') writes++;
      return originalAdd.call(this, value, key);
    };
    IDBObjectStore.prototype.get = function (key) {
      reads.push(this.name);
      return originalGet.call(this, key);
    };
    IDBObjectStore.prototype.getAll = function (query?: IDBValidKey | IDBKeyRange | null, count?: number) {
      reads.push(this.name);
      return originalGetAll.call(this, query, count);
    };
    await store.list();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('paper-puppeteer-recovery', 2);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const counts = () =>
      new Promise<number[]>((resolve, reject) => {
        const tx = db.transaction(['binaries', 'references'], 'readonly');
        const binaries = tx.objectStore('binaries').count();
        const references = tx.objectStore('references').count();
        tx.oncomplete = () => resolve([binaries.result, references.result]);
        tx.onabort = () => reject(tx.error);
      });
    try {
      await store.save('film', 'tab', 'Film', '1', files);
      await store.save('film', 'tab', 'Film', '2', files);
      const unchanged = { hashes, writes, counts: await counts() };
      files.set('project.json', new TextEncoder().encode('{"frame":2}'));
      await store.save('film', 'tab', 'Film', '3', files);
      files.set('project.json', new TextEncoder().encode('{"frame":3}'));
      await store.save('film', 'tab', 'Film', '4', files);
      // Independently allocated equal content shares storage across projects too.
      const otherImage = image.slice();
      await store.save(
        'other',
        'tab',
        'Other',
        '1',
        new Map([
          ['project.json', files.get('project.json')!.slice()],
          ['image.png', otherImage],
          ['alias.png', otherImage],
        ]),
      );
      const retained = { hashes, writes, counts: await counts() };
      const oldId = (await store.list())[0]!.id;
      image[0] = 9;
      const saving = store.save('film', 'tab', 'Film', '5', files);
      // Changes during hashing must not alter the detached save capture.
      image[0] = 7;
      await saving;
      const mutated = { hashes, writes };
      const newest = (await store.list()).find((entry) => entry.key === 'film')!;
      const metadataReads = [...reads];
      const recovered = [...(await store.read(newest.id)).get('image.png')!];
      const previous = [...(await store.read(oldId)).get('image.png')!];
      const checkpoint = { entries: await store.list(), counts: await counts() };
      // Abort after inserting new binaries/references and starting retention.
      // oxlint-disable-next-line typescript/unbound-method -- Called with the original receiver below.
      const originalDelete = IDBObjectStore.prototype.delete;
      let interrupted = '';
      IDBObjectStore.prototype.delete = function (key) {
        const result = originalDelete.call(this, key);
        if (this.name === 'revisions') this.transaction.abort();
        return result;
      };
      try {
        await store.save('film', 'tab', 'Film', 'interrupted', files);
      } catch (error) {
        interrupted = String(error);
      } finally {
        IDBObjectStore.prototype.delete = originalDelete;
      }
      const rollback = { entries: await store.list(), counts: await counts() };
      reads.length = 0;
      await store.discard('film', 'tab');
      const shared = await counts();
      await store.discard('other', 'tab');
      return {
        unchanged,
        retained,
        mutated,
        checkpoint,
        rollback,
        interrupted,
        metadataReads,
        discardReads: reads,
        recovered,
        previous,
        shared,
        empty: await counts(),
      };
    } finally {
      crypto.subtle.digest = originalDigest;
      IDBObjectStore.prototype.add = originalAdd;
      IDBObjectStore.prototype.get = originalGet;
      IDBObjectStore.prototype.getAll = originalGetAll;
      db.close();
    }
  });
  expect(result.unchanged).toEqual({ hashes: 2, writes: 2, counts: [2, 2] });
  expect(result.retained).toEqual({ hashes: 6, writes: 4, counts: [3, 3] });
  expect(result.mutated).toEqual({ hashes: 7, writes: 5 });
  expect(result.metadataReads.every((name) => ['leases', 'revisions', 'references'].includes(name))).toBe(true);
  expect(result.discardReads.every((name) => name === 'leases' || name === 'references')).toBe(true);
  expect(result.recovered).toEqual([9, 2, 3]);
  expect(result.previous).toEqual([1, 2, 3]);
  expect(result.interrupted).toBeTruthy();
  expect(result.rollback).toEqual(result.checkpoint);
  expect(result.shared).toEqual([2, 1]);
  expect(result.empty).toEqual([0, 0]);
});

test('version-one drafts migrate metadata without copying binaries and preserve incompatible revisions', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'development', 'Direct module harness uses the local Vite source server.');
  // Seed before loading an authoring route, which opens recovery storage itself.
  await page.route('**/src/main.ts', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('index.html');
  await page.evaluate(async () => {
    const bytes = new TextEncoder().encode('{}');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('paper-puppeteer-recovery', 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore('drafts', { keyPath: 'id' }).createIndex('key', 'key');
        opening.result.createObjectStore('leases', { keyPath: 'key' });
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      const drafts = tx.objectStore('drafts');
      const record = {
        version: 1,
        id: 'old',
        key: 'film',
        name: 'Film',
        revision: '1',
        savedAt: 1,
        files: [{ path: 'project.json', blob: new Blob([bytes]), digest }],
      };
      drafts.add(record);
      drafts.add({ ...record, id: 'future', version: 99 });
      drafts.add({ id: 'broken', version: 1, savedAt: Number.MAX_VALUE });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.addScriptTag({
    type: 'module',
    content: `import { LocalDraftStore } from '/src/devtools/shared/autosave/LocalDraftStore.ts'; window.localDraftTest = new LocalDraftStore();`,
  });
  await page.waitForFunction(() => !!window.localDraftTest);
  const result = await page.evaluate(async () => {
    const store = window.localDraftTest;
    const initial = await store.list();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('paper-puppeteer-recovery', 2);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const counts = () =>
      new Promise<number[]>((resolve, reject) => {
        const tx = db.transaction(['drafts', 'binaries'], 'readonly');
        const legacy = tx.objectStore('drafts').count();
        const binaries = tx.objectStore('binaries').count();
        tx.oncomplete = () => resolve([legacy.result, binaries.result]);
        tx.onabort = () => reject(tx.error);
      });
    const before = await counts();
    const recovered = new TextDecoder().decode((await store.read('old')).get('project.json'));
    const files = new Map([['project.json', new TextEncoder().encode('{}')]]);
    await store.save('film', 'tab', 'Film', '2', files);
    const retainedOld = (await store.list()).some((entry) => entry.id === 'old');
    await store.save('film', 'tab', 'Film', '3', files);
    const after = await counts();
    let future = '';
    try {
      await store.read('future');
    } catch (error) {
      future = String(error);
    }
    await store.discard('film', 'tab');
    await store.discard('corrupt:broken', 'tab');
    const empty = await counts();
    db.close();
    return { initial, before, recovered, retainedOld, after, future, empty, remaining: await store.list() };
  });
  expect(result.initial).toHaveLength(3);
  expect(result.initial.find((entry) => entry.id === 'broken')).toMatchObject({ key: 'corrupt:broken', savedAt: 0 });
  expect(result.before).toEqual([3, 0]);
  expect(result.recovered).toBe('{}');
  expect(result.retainedOld).toBe(true);
  expect(result.after).toEqual([2, 1]);
  expect(result.future).toContain('Unsupported local snapshot version');
  expect(result.empty).toEqual([0, 0]);
  expect(result.remaining).toEqual([]);
});
