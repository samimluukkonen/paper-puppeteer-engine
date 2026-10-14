import { test as base, expect, type Locator, type Page } from '@playwright/test';

/** Expand the inspector's initially collapsed bone hierarchy before using its controls. */
export async function animationHierarchy(page: Page): Promise<Locator> {
  const panel = page.locator('.animation-bone-list');
  if (!(await panel.evaluate((element) => (element as HTMLDetailsElement).open)))
    await panel.locator(':scope > summary').click();
  return page.locator('#animation-bones');
}

/** Follow the visible disclosure before interacting with a secondary animation command. */
export async function animationMenuControl(page: Page, selector: string): Promise<Locator> {
  const control = page.locator(selector);
  const menuIds = await control.evaluate((element) => {
    const ids: string[] = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      if (parent.matches('details[data-workspace-menu]')) ids.unshift(parent.id);
    return ids;
  });
  for (const id of menuIds) {
    const menu = page.locator(`#${id}`);
    if (!(await menu.evaluate((element) => (element as HTMLDetailsElement).open)))
      await menu.locator(':scope > summary').click();
  }
  return control;
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
  if (!(await dialog.isVisible())) await page.locator('#rig-tools-open').click();
  const result = await action(page.locator(selector));
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  return result;
}

/** Follow the workspace's settings disclosure before interacting with authored controls. */
export async function animationControl(page: Page, selector: string): Promise<Locator> {
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
        // Navigating between the demo and editor can cancel an in-flight resource request.
        if (request.url().startsWith(`${origin}/`) && reason !== 'net::ERR_ABORTED')
          errors.push(`${reason} ${request.url()}`);
      });
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
