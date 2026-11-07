import { test, expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
      resultIndex = 0;
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
      const rec = (window as any).__rec;
      const index = rec.resultIndex++;
      const results = Array(index).fill(null).concat([result]);
      rec.onresult({ resultIndex: index, results });
    };
    (window as any).__revise = (text: string, isFinal: boolean) => {
      const rec = (window as any).__rec;
      const result: any = [{ transcript: text }];
      result.isFinal = isFinal;
      const index = rec.resultIndex;
      rec.onresult({ resultIndex: index, results: Array(index).fill(null).concat([result]) });
      if (isFinal) rec.resultIndex++;
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
  const modelLabel = page.getByText('Model imagini: gemini-3.1-flash-lite-image');
  await expect(modelLabel).toBeVisible();

  await page.getByRole('button', { name: 'Începe Citirea' }).click();
  await expect(page.getByRole('button', { name: 'Pauză' })).toBeVisible();

  // 75 words crosses the 70-word threshold that triggers image generation
  const request = page.waitForRequest('**/api/generate-image');
  await page.evaluate(() => (window as any).__say(Array(75).fill('unicorn').join(' ')));
  await request;
  await expect(page.getByRole('img', { name: /Scena (curentă|următoare)|(Current|Next) Scene/ })).toBeVisible({ timeout: 10_000 });
  await expect(modelLabel).toBeVisible();

  await page.getByRole('button', { name: 'Pauză' }).click();
  await expect(page.getByRole('button', { name: 'Începe Citirea' })).toBeVisible();

  expect(errors).toEqual([]);
});

test('speech revisions: debug log shows deduplicated and bounded narration', async ({ page }) => {
  await installFakeSpeech(page);
  await signIn(page);
  const requests: string[] = [];
  await page.route('**/api/generate-image', async route => {
    requests.push(route.request().postDataJSON().description);
    await route.fulfill({ json: {
      image: TINY_PNG,
      storyBible: { characters: [], setting: '', style: '', summary: '' },
      used: requests.length, quota: 200,
    } });
  });
  await page.getByRole('button', { name: 'Începe Citirea' }).click();
  await page.evaluate(() => (window as any).__revise(Array.from({ length: 70 }, (_, i) => `word${i}`).join(' '), false));
  await page.waitForTimeout(500);
  expect(requests).toHaveLength(0);
  await expect.poll(() => requests.length, { timeout: 5000 }).toBe(1);
  await page.evaluate(() => {
    for (let count = 71; count <= 145; count++) {
      (window as any).__revise(Array.from({ length: count }, (_, i) => `word${i}`).join(' '), false);
    }
    (window as any).__revise(Array.from({ length: 145 }, (_, i) => `word${i}`).join(' '), true);
  });
  await expect.poll(() => requests.length).toBe(2);
  const allWords = requests.join(' ').split(/\s+/);
  expect(allWords).toEqual(Array.from({ length: 145 }, (_, i) => `word${i}`));
  expect(requests.every(value => value.length <= 4000)).toBe(true);

  await page.getByTitle('Arată/ascunde consola de depanare').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTitle('Descarcă jurnalul complet').click();
  const download = await downloadPromise;
  const log = await readFile(await download.path(), 'utf8');
  const counts = [...log.matchAll(/NARRATION FOR API REQUEST: (\d+) characters/g)].map(match => Number(match[1]));
  expect(counts).toEqual(requests.map(value => value.length));
  expect(log).not.toContain('GENERATION FAILED: Invalid description');
  console.log(`Speech replay debug log: ${counts.length} requests, narration lengths ${counts.join(', ')}, ${allWords.length} distinct sequential words, no invalid-description errors.`);
});

test('speech buffering: pausing and resuming preserves unfinished narration', async ({ page }) => {
  await installFakeSpeech(page);
  await signIn(page);
  let description = '';
  await page.route('**/api/generate-image', async route => {
    description = route.request().postDataJSON().description;
    await route.fulfill({ json: {
      image: TINY_PNG,
      storyBible: { characters: [], setting: '', style: '', summary: '' },
      used: 1, quota: 200,
    } });
  });
  await page.getByRole('button', { name: 'Începe Citirea' }).click();
  await page.evaluate(() => (window as any).__revise(Array.from({ length: 40 }, (_, i) => `word${i}`).join(' '), false));
  await page.getByRole('button', { name: 'Pauză' }).click();
  await expect(page.getByRole('button', { name: 'Începe Citirea' })).toBeVisible();
  await page.getByRole('button', { name: 'Începe Citirea' }).click();
  await page.evaluate(() => (window as any).__say(Array.from({ length: 30 }, (_, i) => `word${i + 40}`).join(' ')));
  await expect.poll(() => description.length).toBeGreaterThan(0);
  expect(description).toBe(Array.from({ length: 70 }, (_, i) => `word${i}`).join(' '));
});

test('debug log: manual scrolling and holding the mouse pause following new entries', async ({ page }) => {
  await installFakeSpeech(page);
  await signIn(page);
  await page.getByTitle('Arată/ascunde consola de depanare').click();
  await page.getByRole('button', { name: 'Începe Citirea' }).click();
  const log = page.getByRole('region', { name: 'Jurnal de depanare' });
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) (window as any).__say(`entry${i}`);
  });
  await expect(log.getByText('entry39', { exact: false })).toBeVisible();
  await expect.poll(() => log.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(2);
  await log.evaluate(el => { el.scrollTop = 0; });
  await expect.poll(() => log.evaluate(el => el.scrollTop)).toBe(0);
  const box = (await log.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.evaluate(() => {
    for (let i = 40; i < 60; i++) (window as any).__say(`entry${i}`);
  });
  await expect(log.getByText('entry59', { exact: false })).toHaveCount(1);
  expect(await log.evaluate(el => el.scrollTop)).toBe(0);
  await expect(log.getByText('entry0', { exact: false })).toBeVisible();
  await page.mouse.up();
  await page.evaluate(() => (window as any).__say('entry60'));
  await expect(log.getByText('entry60', { exact: false })).toHaveCount(1);
  expect(await log.evaluate(el => el.scrollTop)).toBe(0);
  await log.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => log.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(2);
  await page.evaluate(() => (window as any).__say('entry61'));
  await expect(log.getByText('entry61', { exact: false })).toBeVisible();
  await expect.poll(() => log.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(2);
});

test('history: selecting an illustration does not change its brightness after the transition', async ({ page }) => {
  await installFakeSpeech(page);
  await signIn(page);
  let generated = 0;
  await page.route('**/api/generate-image', route => {
    const color = generated++ === 0 ? '#367db1' : '#c98745';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${color}"/></svg>`;
    return route.fulfill({ json: {
      image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      storyBible: { characters: [], setting: '', style: '', summary: '' },
      used: generated, quota: 200,
    } });
  });
  await page.getByRole('button', { name: 'Începe Citirea' }).click();
  await page.evaluate(() => (window as any).__say(Array(75).fill('fox').join(' ')));
  await expect(page.getByRole('img', { name: 'Scena curentă' })).toBeVisible();
  await page.evaluate(() => (window as any).__say(Array(75).fill('castle').join(' ')));
  const historyImage = page.getByRole('button', { name: 'Istoric 1', exact: true });
  await expect(historyImage).toBeVisible();
  await page.waitForTimeout(1400);
  await historyImage.click();
  const nextImage = page.getByRole('img', { name: 'Scena următoare' });
  await expect(nextImage).toBeVisible();
  await nextImage.scrollIntoViewIfNeeded();
  const box = (await nextImage.boundingBox())!;
  const pixel = async () => {
    const png = await page.screenshot({ clip: { x: Math.floor(box.x + box.width / 4), y: Math.floor(box.y + box.height / 3), width: 1, height: 1 } });
    return page.evaluate(async base64 => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.drawImage(img, 0, 0);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    }, png.toString('base64'));
  };
  const during = await pixel();
  await expect(nextImage).toHaveCount(0);
  const after = await pixel();
  expect(after).toEqual(during);
});

test('history: every illustration remains selectable in a scrollable current-story timeline', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await installFakeSpeech(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Începe Citirea' }).click();
  for (let count = 1; count <= 7; count++) {
    await page.evaluate(() => (window as any).__say(Array(75).fill('fox').join(' ')));
    await expect(page.getByRole('region', { name: 'Istoricul Poveștii' }).getByRole('button')).toHaveCount(count);
  }
  const timeline = page.getByRole('region', { name: 'Istoricul Poveștii' });
  expect(await timeline.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Istoric 7', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => timeline.evaluate(el => getComputedStyle(el).scrollbarWidth)).not.toBe('none');

  await page.getByRole('button', { name: 'Istoric 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Istoric 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(timeline.getByRole('button')).toHaveCount(7);
  await page.getByRole('button', { name: 'Istoric 7', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Istoric 7', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('img', { name: 'Scena următoare' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Pauză' }).click();
  await page.getByRole('button', { name: 'Poveste nouă' }).click();
  await expect(timeline).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Scena curentă' })).toHaveCount(0);
});

test('painting indicator starts immediately with image generation and stops on completion or failure', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    (window as any).__imageStreams = [];
    window.fetch = (input, init) => {
      if (typeof input !== 'string' || input !== '/api/generate-image') return originalFetch(input, init);
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) { (window as any).__imageStreams.push(controller); },
      }), { headers: { 'Content-Type': 'application/x-ndjson' } }));
    };
    (window as any).__imageEvent = (index: number, event: object, close = false) => {
      const controller = (window as any).__imageStreams[index];
      controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
      if (close) controller.close();
    };
  });
  await installFakeSpeech(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Începe Citirea' }).click();
  await expect(page.getByRole('button', { name: 'Pauză' })).toBeVisible();
  const paint = page.getByText('Se pictează...', { exact: true });
  const result = {
    type: 'result', image: TINY_PNG,
    storyBible: { characters: [], setting: '', style: '', summary: '' }, used: 1, quota: 200,
  };

  await page.evaluate(() => (window as any).__say(Array(75).fill('unicorn').join(' ')));
  await page.waitForFunction(() => (window as any).__imageStreams.length === 1);
  await expect(paint).toHaveCount(0);
  await page.getByTitle('Arată/ascunde consola de depanare').click();
  await expect(page.getByText('📏 NARRATION FOR API REQUEST: 599 characters (limit 4000; before validation)')).toBeVisible();
  await page.evaluate(() => (window as any).__imageEvent(0, { type: 'image_started', storyPromptChars: 1234, imagePromptChars: 567 }));
  await expect(paint).toBeVisible({ timeout: 1000 });
  await expect(page.getByText('📏 MODEL TEXT PROMPTS: story 1234 characters; image 567 characters (per attempt; reference image excluded)')).toBeVisible();
  await page.evaluate(result => (window as any).__imageEvent(0, result, true), result);
  await expect(page.getByRole('img', { name: 'Scena curentă' })).toBeVisible();
  await expect(paint).toHaveCount(0);

  await page.evaluate(() => (window as any).__say(Array(75).fill('castle').join(' ')));
  await page.waitForFunction(() => (window as any).__imageStreams.length === 2);
  await expect(paint).toHaveCount(0);
  await page.evaluate(() => (window as any).__imageEvent(1, { type: 'image_started' }));
  await expect(paint).toBeVisible({ timeout: 1000 });
  await expect(page.locator('header').getByText(/🎨/)).toHaveCount(0);
  await expect(page.locator('header').getByTitle('Imagini folosite')).toBeVisible();
  await page.evaluate(result => (window as any).__imageEvent(1, result, true), result);
  await expect(paint).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Scena următoare' })).toBeVisible();

  await page.evaluate(() => (window as any).__say(Array(75).fill('forest').join(' ')));
  await page.waitForFunction(() => (window as any).__imageStreams.length === 3);
  await expect(page.getByRole('img', { name: 'Scena curentă' })).toBeVisible();
  await page.evaluate(() => (window as any).__imageEvent(2, { type: 'image_started' }));
  await expect(paint).toBeVisible({ timeout: 2000 });
  await page.evaluate(() => (window as any).__imageEvent(2, { type: 'error', error: 'Test failure' }, true));
  await expect(paint).toHaveCount(0);
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
  await expect(page.getByText('Image model: gemini-3.1-flash-lite-image')).toBeVisible();
  await expect(page.getByRole('img', { name: /dad reads aloud/ })).toBeVisible();
  await expect(page.getByText('Read a book aloud, next to a screen.')).toBeVisible();
  await expect(page.getByText('1. Setup')).toBeVisible();
  await expect(page.getByText('2. Tell a story')).toBeVisible();
  await expect(page.getByText('4. The story goes on')).toBeVisible();
  await page.screenshot({ path: 'test-results/demo-intro-en.png' });
});
