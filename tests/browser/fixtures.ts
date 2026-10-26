import { test as base, expect, type Frame, type FrameLocator, type Locator, type Page } from '@playwright/test';

/** UI commands install poses synchronously; allow Phaser to paint before taking a pixel baseline. */
export async function waitForPreviewPaint(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/** Reveal inspector tabs and disclosures through their visible controls. */
export async function inspectorControl(page: Page | Frame, selector: string): Promise<Locator> {
  const control = page.locator(selector);
  await control.first().waitFor({ state: 'attached' });
  for (const panel of await control.first().locator('xpath=ancestor-or-self::*[@data-editor-tab-panel]').all()) {
    const tab = await panel.getAttribute('data-editor-tab-panel');
    await page.locator(`[id="${tab}-tab"]`).click();
  }
  for (const panel of await control.first().locator('xpath=ancestor-or-self::details').all()) {
    if (!(await panel.evaluate((element) => (element as HTMLDetailsElement).open)))
      await panel.locator(':scope > summary').click();
  }
  return control;
}

/** Switch scene inspector groups without changing their disclosure state. */
export async function sceneInspectorGroup(
  page: Page | Frame,
  group: 'Scene' | 'Actors' | 'Camera' | 'Artwork' | 'Dialogue' | 'Audio' | 'Transitions',
): Promise<void> {
  await page
    .getByRole('tablist', { name: 'Scene inspector groups' })
    .getByRole('tab', { name: group, exact: true })
    .click();
}

/** Reveal secondary scene timeline commands without changing authored state. */
export async function sceneTimelineGroup(
  page: Page | Frame | FrameLocator,
  group: 'Actions' | 'Camera' | 'Transitions' | 'Dialogue' | 'Audio' | 'View',
): Promise<void> {
  await page
    .getByRole('tablist', { name: 'Scene timeline tools' })
    .getByRole('tab', { name: group, exact: true })
    .click();
}

/** Reveal the hierarchy tab in the active Rig Editor or Rig Tweak inspector. */
export async function rigHierarchy(page: Page): Promise<Locator> {
  if (await page.locator('#editor-app').isVisible()) {
    await inspectorControl(page, '#hierarchy');
    return page.locator('#hierarchy');
  }
  await inspectorControl(page, '#tweak-hierarchy');
  return page.locator('#tweak-hierarchy');
}

/** Selecting an already selected bone would now toggle it off. */
export async function selectRigEntry(page: Page, name: string, showDetails = true): Promise<void> {
  const entry = (await rigHierarchy(page)).getByRole('treeitem', { name, exact: true });
  if ((await entry.getAttribute('aria-selected')) === 'true') await entry.focus();
  else await entry.click();
  if (showDetails && (await page.locator('#editor-app').isVisible())) await inspectorControl(page, '#inspector');
}

export async function animationIKInspector(page: Page): Promise<Locator> {
  await inspectorControl(page, '#animation-ik-inspector fieldset');
  return page.locator('#animation-ik-inspector');
}

/** Expand the inspector's bone hierarchy tab before using its controls. */
export async function animationHierarchy(page: Page): Promise<Locator> {
  const settings = page.locator('#animation-clip-settings');
  if (await settings.evaluate((element) => (element as HTMLDetailsElement).open))
    await settings.locator(':scope > summary').click();
  await inspectorControl(page, '#animation-bones');
  return page.locator('#animation-bones');
}

/** Select for editing while preserving an existing selection instead of toggling it off. */
export async function selectAnimationBone(page: Page, name: string): Promise<void> {
  const entry = (await animationHierarchy(page)).getByRole('button', { name, exact: true });
  if ((await entry.getAttribute('aria-pressed')) === 'true') await entry.focus();
  else await entry.click();
  await inspectorControl(page, '#animation-bone-inspector');
}

/** Calibrate the fitted rig camera from visible joint references, without private scene hooks. */
export async function rigCanvasProjection(page: Page) {
  await inspectorControl(page, '#visibility');
  const canvas = page.locator('#editor-stage canvas');
  const visibility = await page.locator('#visibility input').evaluateAll((inputs) =>
    inputs.map((input) => ({
      key: (input as HTMLInputElement).dataset.visibility!,
      checked: (input as HTMLInputElement).checked,
    })),
  );
  await page.locator('#edit-mode').selectOption('sprite');
  for (const key of ['artwork', 'bones', 'slots']) await page.locator(`input[data-visibility="${key}"]`).uncheck();
  const reference = async (slot: string) => {
    await (await rigHierarchy(page)).getByRole('treeitem', { name: `◇ ${slot}`, exact: true }).click();
    const world = (await page.locator('#inspector [data-alignment="joint"]').textContent())!.split(',').map(Number);
    const png = await canvas.screenshot();
    const screen = await page.evaluate(
      async (data) => {
        const bitmap = await createImageBitmap(await (await fetch(data)).blob());
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = surface.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        let x = 0,
          y = 0,
          count = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (
            Math.abs(pixels[i]! - 33) <= 2 &&
            Math.abs(pixels[i + 1]! - 124) <= 2 &&
            Math.abs(pixels[i + 2]! - 135) <= 2
          ) {
            x += (i / 4) % bitmap.width;
            y += Math.floor(i / 4 / bitmap.width);
            ++count;
          }
        }
        bitmap.close();
        if (!count) throw new Error('Missing rendered joint reference.');
        return { x: x / count / surface.width, y: y / count / surface.height };
      },
      `data:image/png;base64,${png.toString('base64')}`,
    );
    return { world: { x: world[0]!, y: world[1]! }, screen };
  };
  const head = await reference('headVisual');
  const torso = await reference('torsoVisual');
  const scaleY = (head.screen.y - torso.screen.y) / (head.world.y - torso.world.y);
  const canvasBounds = await canvas.boundingBox();
  if (!canvasBounds) throw new Error('Missing rig canvas.');
  const scaleX = (scaleY * canvasBounds.height) / canvasBounds.width;
  await inspectorControl(page, '#visibility');
  for (const { key, checked } of visibility) await page.locator(`input[data-visibility="${key}"]`).setChecked(checked);
  await page.locator('#edit-mode').selectOption('joint');
  await canvas.click({ position: { x: 4, y: 4 } });
  await page.getByRole('heading', { name: 'Rig Editor Bind Pose', exact: true }).click();
  return {
    head: head.world,
    async point(x: number, y: number) {
      const bounds = await canvas.boundingBox();
      if (!bounds) throw new Error('Missing rig canvas.');
      return {
        x: bounds.x + (head.screen.x + (x - head.world.x) * scaleX) * bounds.width,
        y: bounds.y + (head.screen.y + (y - head.world.y) * scaleY) * bounds.height,
      };
    },
  };
}

/** Reveal timeline tabs and menus through their visible controls. */
export async function timelineControl(page: Page, selector: string): Promise<Locator> {
  return inspectorControl(page, selector);
}

/** Reveal the tab and disclosure containing a secondary animation command. */
export async function animationMenuControl(page: Page, selector: string): Promise<Locator> {
  return inspectorControl(page, selector);
}

export async function toggleAnimationToolPanel(page: Page, tool: 'mirror' | 'bake'): Promise<void> {
  const panel = page.locator(`#animation-${tool}-panel`);
  if (await panel.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await panel.locator('[data-close-panel]').click();
  } else {
    await (await animationMenuControl(page, `#animation-${tool}-open`)).click();
  }
}

/** Follow the rig workspace's File tools dialog, then return focus to the editor. */
export async function rigFileAction<T>(
  page: Page,
  selector: string,
  action: (control: Locator) => Promise<T>,
): Promise<T> {
  const dialog = page.locator('#rig-tools-dialog');
  if (!(await dialog.isVisible())) await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  if (!(await dialog.isVisible())) await page.locator('#rig-tools-open').click();
  const result = await action(page.locator(selector));
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  return result;
}

/** Follow the workspace's settings disclosure before interacting with authored controls. */
export async function animationControl(page: Page, selector: string): Promise<Locator> {
  if (!(await page.locator('#animation-edit-panel').isVisible()))
    await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  if (selector === '#animation-download') {
    const dialog = page.locator('#animation-tools-dialog');
    if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  } else {
    const settings = page.locator('#animation-clip-settings');
    if (!(await settings.evaluate((element) => (element as HTMLDetailsElement).open)))
      await settings.locator('summary').click();
  }
  return page.locator(selector);
}

/** Complete a file-tool action and return to the workspace, retaining an unfinished import form. */
export async function animationFileAction<T>(
  page: Page,
  selector: string,
  action: (control: Locator) => Promise<T>,
): Promise<T> {
  const dialog = page.locator('#animation-tools-dialog');
  if (!(await dialog.isVisible())) await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  if (!(await dialog.isVisible())) await page.locator('#animation-tools-open').click();
  const result = await action(page.locator(selector));
  if (
    selector === '#animation-import-paste' ||
    selector === '#animation-import-text' ||
    (selector === '#animation-import-submit' && (await page.locator('#animation-import-panel').isVisible()))
  )
    return result;
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  return result;
}

/** Every browser scenario must load its local assets without exceptions or failed requests. */
export const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [
    async ({ page, baseURL }, use) => {
      const errors: string[] = [];
      const origin = new URL(baseURL!).origin;
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => {
        if (
          response.url().startsWith(`${origin}/`) &&
          response.status() >= 400 &&
          response.request().resourceType() !== 'other'
        )
          errors.push(`${response.status()} ${response.url()}`);
      });
      page.on('requestfailed', (request) => {
        const reason = request.failure()?.errorText;
        // Navigating between views can cancel an in-flight resource request.
        if (request.url().startsWith(`${origin}/`) && reason !== 'net::ERR_ABORTED')
          errors.push(`${reason} ${request.url()}`);
      });
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
