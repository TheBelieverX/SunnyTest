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
  expect((await request.post('/api/feedback', { data: { category: 'idea', message: 'A suggestion' } })).status()).toBe(401);
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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Povești Magice');
  expect(body.toLowerCase()).toContain('vizualizator de povești');

  await page.getByRole('switch').click();
  await expect(page.getByRole('button', { name: 'Start Reading' })).toBeVisible();
  body = await text();
  enOnly.forEach(s => expect(body).toContain(s));
  [...roOnly, 'Pauză'].forEach(s => expect(body).not.toContain(s));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Magic Stories');
  expect(body.toLowerCase()).toContain('story visualizer');
  expect(body).not.toContain('Povești Magice');
  expect(body.toLowerCase()).not.toContain('vizualizator');
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

test('feedback: submits an idea from a mobile-friendly form on desktop and phone', async ({ page }) => {
  await signIn(page);
  let submitted: Record<string, unknown> | undefined;
  let authorization: string | undefined;
  await page.route('**/api/feedback', async route => {
    submitted = route.request().postDataJSON();
    authorization = route.request().headers().authorization;
    await route.fulfill({ status: 201, json: { ok: true } });
  });

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 375, height: 667 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Trimite feedback' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    await page.getByLabel('Tip de feedback').selectOption('idea');
    await page.getByPlaceholder('Spune-ne ce s-a întâmplat sau ce ai vrea să îmbunătățim.').fill('Please add more story themes.');
    await page.getByRole('button', { name: 'Evaluează cu 4 din 5' }).click();
    await page.getByLabel('Sunt de acord să fiu contactat(ă) pentru detalii.').check();
    await dialog.getByRole('button', { name: 'Trimite feedback' }).click();
    await expect(page.getByRole('status')).toHaveText('Mesajul tău a fost trimis.');
    expect(submitted).toEqual({
      category: 'idea',
      message: 'Please add more story themes.',
      rating: 4,
      followUp: true,
    });
    expect(authorization).toMatch(/^Bearer \S+$/);

    await page.getByRole('button', { name: 'Gata' }).click();
    await expect(dialog).toHaveCount(0);

    if (viewport.width === 1280) {
      await page.getByRole('switch').click();
      await expect(page.getByRole('button', { name: 'Send feedback' })).toBeVisible();
      await page.getByRole('switch').click();
    }
  }
});

test('feedback: failures show a localized message, keep the text, and a retry can succeed', async ({ page }) => {
  await signIn(page);
  const outcomes = ['abort', 500, 429, 201] as const;
  let calls = 0;
  await page.route('**/api/feedback', route => {
    const outcome = outcomes[calls++];
    return outcome === 'abort' ? route.abort() : route.fulfill({ status: outcome, json: { error: 'internal detail' } });
  });

  await page.getByRole('button', { name: 'Trimite feedback' }).first().click();
  const dialog = page.getByRole('dialog');
  const message = page.getByPlaceholder('Spune-ne ce s-a întâmplat sau ce ai vrea să îmbunătățim.');
  await message.fill('Keep this text');
  const send = dialog.getByRole('button', { name: 'Trimite feedback' });

  const generic = 'Feedbackul nu a putut fi trimis. Încearcă din nou.';
  await send.click();
  await expect(dialog.getByRole('alert')).toHaveText(generic);
  await send.click();
  await expect(dialog.getByRole('alert')).toHaveText(generic);
  await send.click();
  await expect(dialog.getByRole('alert')).toHaveText('Ai trimis prea multe mesaje. Încearcă din nou mai târziu.');
  await expect(message).toHaveValue('Keep this text');
  expect(await dialog.innerText()).not.toContain('internal detail');

  await send.click();
  await expect(dialog.getByRole('status')).toHaveText('Mesajul tău a fost trimis.');
  expect(calls).toBe(4);
});

test('feedback: double-clicking send submits only once', async ({ page }) => {
  await signIn(page);
  let calls = 0;
  await page.route('**/api/feedback', async route => {
    calls++;
    await new Promise(r => setTimeout(r, 600));
    await route.fulfill({ status: 201, json: { ok: true } });
  });

  await page.getByRole('button', { name: 'Trimite feedback' }).first().click();
  const dialog = page.getByRole('dialog');
  await page.getByPlaceholder('Spune-ne ce s-a întâmplat sau ce ai vrea să îmbunătățim.').fill('Only once');
  await dialog.getByRole('button', { name: 'Trimite feedback' }).dblclick();
  await expect(dialog.getByRole('status')).toBeVisible();
  expect(calls).toBe(1);
});

test('feedback: the API rejects wrong methods and malformed or oversized requests without a session', async ({ request }) => {
  test.setTimeout(60_000);
  for (const method of ['get', 'put', 'delete'] as const) {
    expect((await request[method]('/api/feedback')).status(), method).toBe(405);
  }
  const malformed = await request.post('/api/feedback', { headers: { 'Content-Type': 'application/json' }, data: '{not json' });
  expect(malformed.status()).toBe(401);
  const huge = await request.post('/api/feedback', { data: { category: 'idea', message: 'x'.repeat(1_000_000) } });
  expect(huge.status()).toBe(401);
});

test('runtime: a spoken story produces an illustration with no console or page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`console: ${m.text()} (${m.location().url})`);
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

test('demo: the intro shows a parent reading aloud next to a screen, in both languages', async ({ page }) => {
  await signIn(page);
  const img = page.getByRole('img', { name: /cu voce tare unei fetițe/ });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await expect(page.getByText('Citiți cu voce tare dintr-o carte, lângă un ecran.')).toBeVisible();
  await expect(page.getByText('1. Începutul')).toBeVisible();
  await expect(page.getByText('4. Povestea continuă')).toBeVisible();

  await page.getByRole('switch').click();
  await expect(page.getByRole('img', { name: /dad reads aloud/ })).toBeVisible();
  await expect(page.getByText('Read a book aloud, next to a screen.')).toBeVisible();
  await expect(page.getByText('1. Setup')).toBeVisible();
  await expect(page.getByText('2. Tell a story')).toBeVisible();
  await expect(page.getByText('4. The story goes on')).toBeVisible();
  await page.screenshot({ path: 'test-results/demo-intro-en.png' });
});
