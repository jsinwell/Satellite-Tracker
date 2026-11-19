import { expect, type Locator, type Page, test } from '@playwright/test';

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

/** Opens the sky panel and sets the place by typing its coordinates. */
async function setPlace(page: Page, coordinates: string): Promise<void> {
  await page.getByRole('button', { name: 'Your sky' }).click();
  const field = page
    .getByRole('region', { name: 'Your sky' })
    .getByLabel('Or type its coordinates');
  await field.fill(coordinates);
  await field.press('Enter');
  await expect(page.getByRole('button', { name: 'Look up from here' })).toBeVisible();
}

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

  test('rides along with a satellite, and gets off again', async ({ page }) => {
    await page.goto(`/?sat=25544&t=${FIXTURE_TIME}`);
    const panel = selection(page);
    await expect(panel.getByText(/^4,\d\d\d km across$/)).toBeVisible();

    await panel.getByRole('button', { name: 'Ride along' }).click();
    await expect(page).toHaveURL(/ride=1/);
    await expect(panel.getByRole('button', { name: 'Stop riding' })).toBeVisible();
    // The camera is on the satellite already, so there is nothing to center on.
    await expect(panel.getByRole('button', { name: 'Center view' })).toBeHidden();

    // Choosing another satellite carries on the ride with that one.
    await page.getByRole('combobox').fill('goes 16');
    await page.getByRole('option', { name: /GOES 16/ }).click();
    await expect(panel).toContainText('GOES 16');
    await expect(page).toHaveURL(/sat=41866.*ride=1/);

    // Escape backs out a step at a time: off the ride first, then out of the selection.
    await page.locator('canvas').focus();
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/ride=1/);
    await expect(panel.getByRole('button', { name: 'Ride along' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('opens a linked ride', async ({ page }) => {
    await page.goto(`/?sat=25544&ride=1&t=${FIXTURE_TIME}`);

    await expect(selection(page).getByRole('button', { name: 'Stop riding' })).toBeVisible();
    await expect(page).toHaveURL(/sat=25544.*ride=1/);
    // A click on empty sky deselects, but not in the middle of a ride.
    await page.locator('canvas').click({ position: { x: 20, y: 300 } });
    await expect(selection(page)).toContainText('ISS (ZARYA)');
  });

  test('turns what is drawn for a satellite on and off', async ({ page }) => {
    await page.goto(`/?sat=25544&t=${FIXTURE_TIME}`);
    const panel = selection(page);
    const groundTrack = panel.getByRole('switch', { name: 'Ground track' });
    // Times along the ground track are labeled on the globe.
    const timeLabels = page.locator('[data-track-label]').filter({ visible: true });
    await expect(groundTrack).toHaveAttribute('aria-checked', 'true');
    await expect(timeLabels.first()).toHaveText(/^\d\d:\d0$/);

    await groundTrack.click();
    await expect(groundTrack).toHaveAttribute('aria-checked', 'false');
    await expect(timeLabels).toHaveCount(0);

    // The choice holds for the next satellite.
    await page.getByRole('combobox').fill('goes 16');
    await page.getByRole('option', { name: /GOES 16/ }).click();
    await expect(panel).toContainText('GOES 16');
    await expect(groundTrack).toHaveAttribute('aria-checked', 'false');
    await expect(panel.getByRole('switch', { name: 'Coverage' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('shows what is over a chosen place, and when a satellite passes over it', async ({
    page,
  }) => {
    await page.goto(`/?sat=25544&t=${FIXTURE_TIME}`);
    await page.getByRole('button', { name: 'Your sky' }).click();
    const sky = page.getByRole('region', { name: 'Your sky' });
    const coordinates = sky.getByLabel('Or type its coordinates');

    await coordinates.fill('Chicago');
    await coordinates.press('Enter');
    await expect(sky.getByText(/doesn't look like a latitude and longitude/)).toBeVisible();

    await coordinates.fill('41.88, -87.63');
    await coordinates.press('Enter');
    await expect(sky).toContainText('41.88° N, 87.63° W');
    await expect(sky.getByText(/^[\d,]+ above the horizon/)).toBeVisible();
    // Half past midnight there: it says when to come back.
    await expect(sky.getByText(/^Best time to look: /)).toBeVisible();

    const passes = selection(page).getByRole('list', { name: 'Next passes' });
    await expect(passes.getByRole('listitem').first()).toContainText(/\d+° high · \d+ min/);

    // Choosing a pass sets the clock to just before it.
    const clock = page.getByRole('region', { name: 'Simulation time' }).locator('time');
    const before = await clock.textContent();
    await passes.getByRole('button').first().click();
    await expect(clock).not.toHaveText(before ?? '');

    // The place is remembered for next time. The panel starts closed, and
    // opens with it.
    await page.reload();
    await expect(page.getByText(`${FIXTURE_SIZE} objects tracked`)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your sky' })).toBeHidden();
    await page.getByRole('button', { name: 'Your sky' }).click();
    await expect(page.getByRole('region', { name: 'Your sky' })).toContainText('41.88° N');
  });

  test('looks up at the sky from the chosen place, and comes back', async ({ page }) => {
    await page.goto(`/?t=${FIXTURE_TIME}`);
    await page.getByRole('button', { name: 'Your sky' }).click();
    const sky = page.getByRole('region', { name: 'Your sky' });
    const coordinates = sky.getByLabel('Or type its coordinates');
    await coordinates.fill('41.88, -87.63');
    await coordinates.press('Enter');
    const compass = page.locator('[data-compass-point]').filter({ visible: true });
    await expect(compass).toHaveCount(0);

    await sky.getByRole('button', { name: 'Look up from here' }).click();
    // The view starts toward the south, with the horizon in sight.
    await expect(compass.filter({ hasText: /^S$/ })).toBeVisible();

    // Dragging pulls the sky along with the pointer, as in a panorama.
    const south = compass.filter({ hasText: /^S$/ });
    await page.waitForTimeout(1600); // the way down takes 1.4 s
    const from = (await south.boundingBox())?.x ?? Number.NaN;
    await page.mouse.move(640, 300);
    await page.mouse.down();
    await page.mouse.move(740, 300, { steps: 5 });
    await page.mouse.move(840, 300, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => (await south.boundingBox())?.x ?? Number.NaN)
      .toBeGreaterThan(from + 100);

    // A click on empty sky clears a selection, as it does on the globe.
    await page.getByRole('combobox').fill('iss (zarya)');
    await page.getByRole('option', { name: /ISS \(ZARYA\)/ }).click();
    await expect(selection(page)).toContainText('ISS (ZARYA)');
    await page.mouse.click(700, 110);
    await expect(selection(page)).toBeHidden();

    // Escape comes back up, as the button does.
    await page.locator('canvas').focus();
    await page.keyboard.press('Escape');
    await expect(sky.getByRole('button', { name: 'Look up from here' })).toBeVisible();
    await expect(compass).toHaveCount(0);
  });

  test('lists the planets in the sky', async ({ page }) => {
    // From the North Pole, a planet is up exactly when it is north of the
    // celestial equator, which for these does not change for months.
    await page.goto(`/?t=${FIXTURE_TIME}`);
    await setPlace(page, '90, 0');
    const planets = page.getByRole('list', { name: 'Planets above the horizon' });
    for (const name of ['Mars', 'Jupiter', 'Saturn']) {
      await expect(planets).toContainText(name);
    }
    for (const name of ['Mercury', 'Venus', 'Neptune']) {
      await expect(planets).not.toContainText(name);
    }
    await expect(planets.getByText('Jupiter')).toBeVisible();
  });

  test('says when an eclipse is happening overhead', async ({ page }) => {
    // NASA's greatest eclipse of 2 August 2027, near Luxor: totality lasts
    // over six minutes there.
    await page.goto('/?t=2027-08-02T10:06:00Z');
    await setPlace(page, '25.505, 33.183');
    const sky = page.getByRole('region', { name: 'Your sky' });
    await expect(sky).toContainText('Total solar eclipse: the Moon is covering the Sun.');

    // The total lunar eclipse of 3 March 2026, from Honolulu. The place is
    // remembered, so it is changed from there.
    await page.goto('/?t=2026-03-03T11:34:00Z');
    await page.getByRole('button', { name: 'Your sky' }).click();
    await sky.getByRole('button', { name: 'Change' }).click();
    const field = sky.getByLabel('Or type its coordinates');
    await field.fill('21.31, -157.86');
    await field.press('Enter');
    await expect(sky).toContainText("Lunar eclipse: the Moon is in the Earth's shadow.");
  });

  test('takes a place from a click on the globe', async ({ page }) => {
    await page.goto(`/?t=${FIXTURE_TIME}`);
    await page.getByRole('button', { name: 'Your sky' }).click();
    const sky = page.getByRole('region', { name: 'Your sky' });

    // Escape thinks better of it.
    await sky.getByRole('button', { name: 'Pick on the globe' }).click();
    await expect(sky.getByText('Click where you are on the globe.')).toBeVisible();
    await page.locator('canvas').focus();
    await page.keyboard.press('Escape');
    await expect(sky.getByRole('button', { name: 'Pick on the globe' })).toBeVisible();

    // The Earth fills the middle of the view at the start.
    await sky.getByRole('button', { name: 'Pick on the globe' }).click();
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('The page has no viewport.');
    await page.mouse.click(viewport.width / 2, viewport.height / 2);
    await expect(sky).toContainText(/\d+\.\d+° [NS], \d+\.\d+° [EW]/);
  });

  test.describe('on a touch screen', () => {
    test.use({ hasTouch: true });

    test('widens the view of the sky with a pinch', async ({ page }) => {
      await page.goto(`/?t=${FIXTURE_TIME}`);
      await setPlace(page, '41.88, -87.63');
      await page.getByRole('button', { name: 'Look up from here' }).click();

      // Facing south, south-west is off to the right. A wider view brings it
      // closer to the middle, so its distance from south shrinks.
      const point = (name: string) => page.locator(`[data-compass-point="${name}"]`);
      const apart = async () => {
        const [south, southWest] = await Promise.all([
          point('S').boundingBox(),
          point('SW').boundingBox(),
        ]);
        if (!south || !southWest) throw new Error('A compass point is off screen.');
        return southWest.x - south.x;
      };
      await expect(point('SW')).toBeVisible();
      await page.waitForTimeout(1600); // the way down takes 1.4 s
      const before = await apart();
      const southBefore = (await point('S').boundingBox())?.x ?? Number.NaN;

      // Two fingers 400 px apart, drawn together to 100 px, about the middle.
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', spread: number) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints:
            type === 'touchEnd'
              ? []
              : [
                  { x: 640 - spread / 2, y: 360, id: 1 },
                  { x: 640 + spread / 2, y: 360, id: 2 },
                ],
        });
      await touch('touchStart', 400);
      for (let spread = 380; spread >= 100; spread -= 20) await touch('touchMove', spread);
      await touch('touchEnd', 0);

      await expect.poll(apart).toBeLessThan(before * 0.8);
      // A pinch zooms about the middle and turns nothing: south stays put.
      const southAfter = (await point('S').boundingBox())?.x ?? Number.NaN;
      expect(Math.abs(southAfter - southBefore)).toBeLessThan(40);
    });
  });

  test('moves with the keyboard', async ({ page }) => {
    await page.goto(`/?t=${FIXTURE_TIME}`);
    await setPlace(page, '41.88, -87.63'); // the globe turns to show it, marked "You"
    const holdD = async () => {
      await page.keyboard.down('d');
      await page.waitForTimeout(500);
      await page.keyboard.up('d');
    };
    const x = async (target: Locator) => (await target.boundingBox())?.x ?? Number.NaN;

    const you = page.getByText('You', { exact: true });
    await expect(you).toBeVisible();
    await page.waitForTimeout(1500); // the turn takes 1.2 s
    const before = await x(you);
    await holdD();
    // The camera goes right around the globe, so the ground slides left.
    await expect.poll(() => x(you)).toBeLessThan(before - 30);

    // Looking up, the same key turns the view right, and south slides left.
    await page.getByRole('button', { name: 'Look up from here' }).click();
    const south = page.locator('[data-compass-point="S"]');
    await expect(south).toBeVisible();
    await page.waitForTimeout(1600); // the way down takes 1.4 s
    const facing = await x(south);
    await holdD();
    await expect.poll(() => x(south)).toBeLessThan(facing - 30);
  });

  test('keeps the sky panel clear of the filters', async ({ page }) => {
    // Short windows are where they used to overlap.
    for (const viewport of [
      { width: 800, height: 420 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/?t=${FIXTURE_TIME}`);
      await setPlace(page, '41.88, -87.63');
      await page.getByRole('button', { name: 'Constellation', exact: true }).click();

      await expect(async () => {
        const sky = await page.locator('#your-sky').boundingBox();
        const filters = await page.getByRole('region', { name: 'Filters' }).boundingBox();
        if (!sky || !filters) throw new Error('A panel is missing.');
        expect(sky.y + sky.height).toBeLessThanOrEqual(filters.y);
      }).toPass({ timeout: 5000 });
      // Reset the place, so the next size starts from scratch.
      await page.evaluate(() => localStorage.clear());
    }
  });

  test.describe('with location access', () => {
    test.use({
      geolocation: { latitude: -33.8688, longitude: 151.2093 },
      permissions: ['geolocation'],
    });

    test('finds where you are', async ({ page }) => {
      await page.goto(`/?t=${FIXTURE_TIME}`);
      await page.getByRole('button', { name: 'Your sky' }).click();
      const sky = page.getByRole('region', { name: 'Your sky' });
      await sky.getByRole('button', { name: 'Use my location' }).click();
      // Rounded to about a kilometer before it is kept.
      await expect(sky).toContainText('33.87° S, 151.21° E');
    });
  });

  test('remembers how the view was set up', async ({ page }) => {
    await page.goto(`/?sat=25544&t=${FIXTURE_TIME}`);
    const colorByConstellation = page.getByRole('button', { name: 'Constellation', exact: true });
    const lowOrbit = page.getByRole('button', { name: /^LEO/ });
    const slider = page.getByRole('slider', { name: 'Launched by' });
    const groundTrack = () => selection(page).getByRole('switch', { name: 'Ground track' });

    await colorByConstellation.click();
    await lowOrbit.click();
    await slider.fill('2010');
    await groundTrack().click();
    await expect(groundTrack()).toHaveAttribute('aria-checked', 'false');

    await page.reload();
    await expect(colorByConstellation).toHaveAttribute('aria-pressed', 'true');
    await expect(lowOrbit).toHaveAttribute('aria-pressed', 'false');
    await expect(slider).toHaveValue('2010');
    await expect(groundTrack()).toHaveAttribute('aria-checked', 'false');
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

  test('limits the view to what had been launched by a given year', async ({ page }) => {
    await page.goto(`/?t=${FIXTURE_TIME}`);
    const slider = page.getByRole('slider', { name: 'Launched by' });
    const payloads = page.getByRole('button', { name: /^Payloads/ });
    const search = page.getByRole('combobox');
    // textContent, not innerText: it is what toHaveText compares against.
    const payloadsToday = (await payloads.textContent()) ?? '';

    await slider.fill('2000');
    await expect(page.getByText(new RegExp(`\\d+ of ${FIXTURE_SIZE} objects shown`))).toBeVisible();
    // The legend counts and the search follow the year, like the globe does.
    await expect(payloads).not.toHaveText(payloadsToday);
    await search.fill('goes 16'); // launched in 2016
    await expect(page.getByText('No matches among the satellites shown.')).toBeVisible();

    // Dragging back to the present lifts the limit entirely.
    await slider.fill((await slider.getAttribute('max')) ?? '');
    await expect(page.getByText(`${FIXTURE_SIZE} objects tracked`)).toBeVisible();
    await expect(payloads).toHaveText(payloadsToday);
    await search.fill('goes 16');
    await expect(page.getByRole('option', { name: /GOES 16/ })).toBeVisible();
  });

  test('colors by constellation and isolates one', async ({ page }) => {
    await page.goto(`/?t=${FIXTURE_TIME}`);
    await page.getByRole('button', { name: 'Constellation', exact: true }).click();

    const starlink = page.getByRole('button', { name: /^Starlink/ });
    const everythingElse = page.getByRole('button', { name: /^Everything else/ });
    await expect(starlink).toHaveAttribute('aria-pressed', 'true');

    // The "only" control appears on the row being pointed at.
    await starlink.hover();
    await page.getByRole('button', { name: 'Show only Starlink' }).click();
    await expect(everythingElse).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(new RegExp(`\\d+ of ${FIXTURE_SIZE} objects shown`))).toBeVisible();

    // Asking for the same one again brings everything back.
    await page.getByRole('button', { name: 'Show only Starlink' }).click();
    await expect(page.getByText(`${FIXTURE_SIZE} objects tracked`)).toBeVisible();

    // Switching back to coloring by type must not leave a hidden filter behind.
    await everythingElse.click();
    await page.getByRole('button', { name: 'Type', exact: true }).click();
    await expect(page.getByText(`${FIXTURE_SIZE} objects tracked`)).toBeVisible();
  });

  test('goes to a chosen date and time', async ({ page }) => {
    await page.goto(`/?t=${FIXTURE_TIME}`);
    const timeBar = page.getByRole('region', { name: 'Simulation time' });
    const openPicker = timeBar.getByRole('button', { name: /UTC$/ });
    const picker = page.getByRole('region', { name: 'Go to a date and time' });
    const field = picker.getByLabel('Go to a date and time (UTC)');

    await openPicker.click();
    await field.fill('2027-08-02 10:07');
    // The planets will be right; the satellites, nine months on, will not.
    await expect(picker).toContainText('Satellites this far from today are only a guess');
    await picker.getByRole('button', { name: 'Go' }).click();
    await expect(picker).toBeHidden();
    await expect(timeBar.locator('time')).toContainText('Aug 02, 2027, 10:07');

    // Escape puts it away without going anywhere.
    await openPicker.click();
    await expect(field).toHaveValue(/^2027-08-02 10:07/);
    await field.fill('2030-01-01 00:00:00');
    await field.press('Escape');
    await expect(picker).toBeHidden();
    await expect(timeBar.locator('time')).toContainText('Aug 02, 2027');

    // Something that is not a date goes nowhere, and says what would be one.
    await openPicker.click();
    await field.fill('next Tuesday');
    await field.press('Enter');
    await expect(picker.getByRole('alert')).toContainText('year-month-day');
    await expect(timeBar.locator('time')).toContainText('Aug 02, 2027');
  });

  test('picks a date and time from the calendar', async ({ page }) => {
    await page.goto(`/?t=${FIXTURE_TIME}`);
    const timeBar = page.getByRole('region', { name: 'Simulation time' });
    const picker = page.getByRole('region', { name: 'Go to a date and time' });
    const field = picker.getByLabel('Go to a date and time (UTC)');
    const day = (name: string) => picker.getByRole('button', { name });

    // It opens on the day showing.
    await timeBar.getByRole('button', { name: /UTC$/ }).click();
    await expect(picker.getByRole('table', { name: 'November 2026' })).toBeVisible();
    await expect(day('Monday, November 16, 2026')).toHaveAttribute('aria-pressed', 'true');

    // A day keeps the time of day; the clock sets that.
    await picker.getByRole('button', { name: 'Next month' }).click();
    await day('Friday, December 25, 2026').click();
    await expect(field).toHaveValue(/^2026-12-25 06:30/);
    await picker.getByRole('spinbutton', { name: 'Hours' }).fill('18');
    await picker.getByRole('spinbutton', { name: 'Minutes' }).fill('05');
    await picker.getByRole('spinbutton', { name: 'Seconds' }).fill('00');
    await picker.getByRole('spinbutton', { name: 'Seconds' }).press('ArrowDown');
    await expect(field).toHaveValue('2026-12-25 18:05:59');

    // Decades away is a year and a month, not a hundred presses of an arrow.
    await picker.getByRole('button', { name: 'December 2026' }).click();
    await picker.getByRole('textbox', { name: /^Year/ }).fill('1969');
    await picker.getByRole('button', { name: 'Jul', exact: true }).click();
    await expect(picker.getByRole('table', { name: 'July 1969' })).toBeVisible();
    await day('Sunday, July 20, 1969').click();
    await expect(field).toHaveValue('1969-07-20 18:05:59');

    // The keyboard walks the calendar, and typing in the field turns its page.
    await day('Sunday, July 20, 1969').press('ArrowRight');
    await expect(day('Monday, July 21, 1969')).toBeFocused();
    await expect(field).toHaveValue('1969-07-21 18:05:59');
    await field.fill('2027-08-02 10:07:00');
    await expect(day('Monday, August 2, 2027')).toHaveAttribute('aria-pressed', 'true');

    await picker.getByRole('button', { name: 'Go' }).click();
    await expect(picker).toBeHidden();
    await expect(timeBar.locator('time')).toContainText('Aug 02, 2027, 10:07');
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

test.describe('on a phone-sized screen', () => {
  test.use({ viewport: { width: 420, height: 800 } });

  test('keeps the filters reachable behind a button', async ({ page }) => {
    await serveFixture(page);
    await page.goto(`/?t=${FIXTURE_TIME}`);

    const filters = page.getByRole('region', { name: 'Filters' });
    const toggle = page.getByRole('button', { name: 'Filters', exact: true });
    await expect(page.getByText(`${FIXTURE_SIZE} objects tracked`)).toBeVisible();
    await expect(filters).toBeHidden();

    await toggle.click();
    await expect(filters).toBeVisible();
    await page.getByRole('button', { name: /^Debris/ }).click();
    await expect(page.getByText(new RegExp(`\\d+ of ${FIXTURE_SIZE} objects shown`))).toBeVisible();

    await toggle.click();
    await expect(filters).toBeHidden();
  });

  test('shows a summary of the selection until asked for more', async ({ page }) => {
    await serveFixture(page);
    await page.goto(`/?sat=25544&t=${FIXTURE_TIME}`);
    const panel = selection(page);
    await expect(panel.getByText(/^4\d\d km up/)).toBeVisible();
    await expect(panel.getByText('Inclination')).toBeHidden();
    // Short enough to leave the globe in view.
    const box = await panel.boundingBox();
    expect(box?.height).toBeLessThan(800 * 0.3);

    await page.getByRole('button', { name: 'Show details' }).click();
    await expect(panel.getByText('Inclination')).toBeVisible();

    // There is not room for both, so opening the filters folds the details away.
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(panel.getByText('Inclination')).toBeHidden();
  });

  test('takes turns between the sky panel and the filters', async ({ page }) => {
    await serveFixture(page);
    await page.goto(`/?t=${FIXTURE_TIME}`);
    await setPlace(page, '41.88, -87.63');
    const sky = page.getByRole('region', { name: 'Your sky' });
    const filters = page.getByRole('region', { name: 'Filters' });
    const toggle = page.getByRole('button', { name: 'Filters', exact: true });

    await toggle.click();
    await expect(filters).toBeVisible();
    await expect(sky).toBeHidden();

    await toggle.click();
    await expect(sky).toBeVisible();

    // And the other way round: the sky button brings the sky back.
    await toggle.click();
    await expect(sky).toBeHidden();
    await page.getByRole('button', { name: 'Your sky' }).click();
    await expect(sky).toBeVisible();
    await expect(filters).toBeHidden();
  });

  test('keeps every control on screen', async ({ page }) => {
    await serveFixture(page);
    await page.goto(`/?sat=25544&t=${FIXTURE_TIME}`);
    await expect(selection(page)).toContainText('ISS (ZARYA)');

    for (const control of [
      page.getByRole('combobox'),
      page.getByRole('button', { name: 'Filters', exact: true }),
      page.getByRole('button', { name: 'Pause' }),
      page.getByText(`${FIXTURE_SIZE} objects tracked`),
    ]) {
      await expect(control).toBeInViewport({ ratio: 1 });
    }
  });
});

test('lays the bottom row out by screen width, not by what happens to fit', async ({ page }) => {
  await serveFixture(page);
  // Two widths in the same tier that used to wrap differently.
  for (const width of [766, 776]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?t=${FIXTURE_TIME}`);
    const status = await page.getByText(`${FIXTURE_SIZE} objects tracked`).boundingBox();
    const time = await page.getByRole('region', { name: 'Simulation time' }).boundingBox();
    const filters = await page.getByRole('region', { name: 'Filters' }).boundingBox();
    if (!status || !time || !filters) throw new Error('Part of the bottom row is missing.');

    // Filters on the left and status on the right, both above the time bar.
    expect(filters.y + filters.height).toBeLessThanOrEqual(time.y);
    expect(status.y + status.height).toBeLessThanOrEqual(time.y);
    expect(status.x).toBeGreaterThan(filters.x + filters.width);
  }
});
