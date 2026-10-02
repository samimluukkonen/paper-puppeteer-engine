import { test as base, expect } from '@playwright/test';

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
