import { expect, type Page, test } from '@playwright/test';

/**
 * These run against a small committed catalog rather than live data, and pin
 * simulated time to just after that catalog's epochs with `?t=`. Propagating
 * the fixture years past its epochs would eventually lose satellites to decay.
 */
const FIXTURE = 'e2e/fixtures/catalog.json';
const FIXTURE_TIME = '2026-11-16T06:30:00Z';
const FIXTURE_SIZE = 251;

async function serveFixture(page: Page): Promise<void> {
  await page.route('**/data/catalog.json', (route) =>
    route.fulfill({ path: FIXTURE, contentType: 'application/json' }),
  );
}

/** Fails the test on any uncaught exception or console error in the page. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

const selection = (page: Page) => page.getByRole('region', { name: 'Selected satellite' });

test.describe('with a catalog', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
    await serveFixture(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('renders the globe and reports what it is tracking', async ({ page }) => {
    await page.goto(`/?t=${FIXTURE_TIME}`);

    await expect(page.getByText(`${FIXTURE_SIZE} objects tracked`)).toBeVisible();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.getByText('Nov 16, 2026, 06:30')).toBeVisible();
  });

  test('finds a satellite by name and shows where it is', async ({ page }) => {
    await page.goto(`/?t=${FIXTURE_TIME}`);

    await page.getByRole('combobox').fill('iss');
    await page.getByRole('option', { name: /ISS \(ZARYA\)/ }).click();

    await expect(selection(page)).toContainText('NORAD 25544');
    await expect(selection(page)).toContainText('LEO');
    // A live altitude proves the worker propagated it and the panel read it back.
    await expect(
      selection(page)
        .getByText(/^4\d\d km$/)
        .first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/sat=25544/);
  });

  test('selects from the keyboard', async ({ page }) => {
    await page.goto(`/?t=${FIXTURE_TIME}`);

    await expect(page.getByRole('combobox')).toBeVisible();
    await page.keyboard.press('/');
    await page.keyboard.type('goes 16');
    await page.keyboard.press('Enter');

    await expect(selection(page)).toContainText('GOES 16');
    await page.keyboard.press('Escape');
    await expect(selection(page)).toBeHidden();
  });

  test('opens a linked satellite', async ({ page }) => {
    await page.goto(`/?sat=41866&t=${FIXTURE_TIME}`);

    await expect(selection(page)).toContainText('GOES 16');
    await expect(selection(page)).toContainText('GEO');
    await expect(
      selection(page)
        .getByText(/^35,[78]\d\d km$/)
        .first(),
    ).toBeVisible();
  });

  test('picks the satellite under the pointer', async ({ page }) => {
    // The camera flies to look straight down on a linked satellite, which
    // leaves it at the exact center of the view: a known place to point at.
    await page.goto(`/?sat=41866&t=${FIXTURE_TIME}`);
    await expect(selection(page)).toContainText('GOES 16');
    // The canvas fills the viewport. Measured from the viewport, not the
    // canvas, which is still at its default size for the first few frames.
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('The page has no viewport.');
    const center = { x: viewport.width / 2, y: viewport.height / 2 };

    // Retried with a fresh pointer move each time: the scene attaches its
    // listeners a few frames after the HUD appears, and the flight takes a moment.
    await expect(async () => {
      await page.mouse.move(center.x + 1, center.y);
      await page.mouse.move(center.x, center.y);
      await expect(page.getByRole('tooltip')).toContainText('GOES 16', { timeout: 500 });
    }).toPass({ timeout: 15_000 });
    // Hover starts a moment before the 1.2 s flight lands, and deselecting
    // cancels it. Let it finish so the satellite is dead center, not just in range.
    await page.waitForTimeout(1500);

    await page.keyboard.press('Escape');
    await expect(selection(page)).toBeHidden();
    await page.mouse.click(center.x, center.y);
    await expect(selection(page)).toContainText('GOES 16');

    // Clicking empty sky clears the selection.
    await page.mouse.click(5, viewport.height * 0.3);
    await expect(selection(page)).toBeHidden();
  });

  test('filters by object type', async ({ page }) => {
    await page.goto(`/?t=${FIXTURE_TIME}`);
    await expect(page.getByText(`${FIXTURE_SIZE} objects tracked`)).toBeVisible();

    const payloads = page.getByRole('button', { name: /Payloads/ });
    await payloads.click();

    await expect(payloads).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(new RegExp(`\\d+ of ${FIXTURE_SIZE} objects shown`))).toBeVisible();
  });

  test('controls simulated time', async ({ page }) => {
    await page.goto('/');
    const live = page.getByRole('button', { name: 'LIVE', exact: true });
    await expect(live).toBeVisible();

    await page.getByRole('button', { name: '1000 times real speed' }).click();
    const goLive = page.getByRole('button', { name: 'GO LIVE' });
    await expect(goLive).toBeVisible();

    await goLive.click();
    await expect(live).toBeVisible();
  });
});

test('explains what to do when there is no catalog', async ({ page }) => {
  await page.route('**/data/catalog.json', (route) => route.fulfill({ status: 404 }));
  await page.goto('/');

  await expect(page.getByRole('alert')).toContainText('npm run data');
});
