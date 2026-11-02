import { test, expect, Page } from '@playwright/test';

// Supabase and the paid image API are stubbed, so these tests need no credentials,
// cost nothing, and run identically on localhost and production.

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

function fakeSession() {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: '00000000-0000-0000-0000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'e2e@example.com',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp: now + 3600, role: 'authenticated' })}.sig`;
  return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'e2e-refresh', user };
}

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function stubBackend(page: Page) {
  await page.route('**/auth/v1/token**', r => r.fulfill({ json: fakeSession() }));
  await page.route('**/api/me', r => r.fulfill({ json: { used: 0, quota: 200 } }));
  await page.route('**/api/track', r => r.fulfill({ json: {} }));
  await page.route('**/api/generate-image', r =>
    r.fulfill({
      json: {
        image: TINY_PNG,
        storyBible: { characters: [], setting: '', style: '', summary: '' },
        used: 1,
        quota: 200,
      },
    })
  );
}

async function signIn(page: Page) {
  await stubBackend(page);
  await page.goto('/');
  await page.getByPlaceholder('Email').fill('e2e@example.com');
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('switch')).toBeVisible();
}

// Replaces the browser speech engine with one the test controls.
async function installFakeSpeech(page: Page) {
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onstart: any; onresult: any; onend: any; onerror: any;
      start() { (window as any).__rec = this; setTimeout(() => this.onstart?.(), 0); }
      stop() { setTimeout(() => this.onend?.(), 0); }
    }
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true });
    Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true });
    (window as any).__say = (text: string) => {
      const result: any = [{ transcript: text }];
      result.isFinal = true;
      (window as any).__rec.onresult({ resultIndex: 0, results: [result] });
    };
  });
}

test('auth: signed-out visitors only see the login form, and bad credentials are rejected', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);

  await page.getByPlaceholder('Email').fill('nobody@example.com');
  await page.getByPlaceholder('Password').fill('wrong-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.locator('form p.text-amber-300')).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);
});

test('auth: API endpoints reject requests without a valid session', async ({ request }) => {
  expect((await request.get('/api/me')).status()).toBe(401);
  expect((await request.post('/api/generate-image', { data: { description: 'test' } })).status()).toBe(401);
  const forged = { headers: { Authorization: 'Bearer not-a-real-token' } };
  expect((await request.get('/api/me', forged)).status()).toBe(401);
});

test('language: every label switches between Romanian and English and the choice persists', async ({ page }) => {
  await signIn(page);
  const text = () => page.locator('body').innerText();
  const roOnly = ['Începe Citirea', 'Deconectare'];
  const enOnly = ['Start Reading', 'Sign out'];

  // Default is Romanian
  let body = await text();
  roOnly.forEach(s => expect(body).toContain(s));
  enOnly.forEach(s => expect(body).not.toContain(s));

  await page.getByRole('switch').click();
  await expect(page.getByRole('button', { name: 'Start Reading' })).toBeVisible();
  body = await text();
  enOnly.forEach(s => expect(body).toContain(s));
  [...roOnly, 'Pauză', 'Cititor de Povești'].forEach(s => expect(body).not.toContain(s));
  expect(body).not.toMatch(/\((Pause|Start Reading|Painting\.\.\.|Timeline)\)/);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Start Reading' })).toBeVisible();

  await page.getByRole('switch').click();
  await expect(page.getByRole('button', { name: 'Începe Citirea' })).toBeVisible();
});

test('responsive: phone, tablet and desktop have no horizontal scroll and key controls stay on screen', async ({ page }) => {
  await signIn(page);

  for (const vp of [
    { name: 'phone', width: 375, height: 667 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1280, height: 800 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${vp.name}: horizontal overflow`).toBeLessThanOrEqual(0);

    for (const control of [
      page.getByRole('button', { name: 'Începe Citirea' }),
      page.getByRole('button', { name: 'Deconectare' }),
      page.getByRole('switch'),
    ]) {
      await expect(control, `${vp.name}: control visible`).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.x, `${vp.name}: left edge`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${vp.name}: right edge`).toBeLessThanOrEqual(vp.width);
      expect(box.y + box.height, `${vp.name}: bottom edge`).toBeLessThanOrEqual(vp.height);
    }
  }
});

test('runtime: a spoken story produces an illustration with no console or page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`console: ${m.text()}`);
  });

  await installFakeSpeech(page);
  await signIn(page);

  await page.getByRole('button', { name: 'Începe Citirea' }).click();
  await expect(page.getByRole('button', { name: 'Pauză' })).toBeVisible();

  // 75 words crosses the 70-word threshold that triggers image generation
  const request = page.waitForRequest('**/api/generate-image');
  await page.evaluate(() => (window as any).__say(Array(75).fill('unicorn').join(' ')));
  await request;
  await expect(page.getByRole('img', { name: /Scena (curentă|următoare)|(Current|Next) Scene/ })).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Pauză' }).click();
  await expect(page.getByRole('button', { name: 'Începe Citirea' })).toBeVisible();

  expect(errors).toEqual([]);
});
