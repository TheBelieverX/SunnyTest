import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { test } from 'node:test';
import type { VercelResponse } from '@vercel/node';
import { ImageTiming } from '../api/_lib/imageTiming.ts';

function response(): VercelResponse {
  return new ServerResponse({ method: 'POST' } as IncomingMessage) as VercelResponse;
}

test('records stages and attempts once without payloads', async () => {
  const res = response();
  const lines: string[] = [];
  const original = console.info;
  console.info = (line: string) => lines.push(line);
  try {
    const timing = new ImageTiming(res);
    await timing.measure('auth', async () => undefined);
    await timing.measure('quota', async () => undefined);
    await timing.measure('story_model', async () => {
      timing.attempt('story_model');
      timing.attempt('story_model');
    });
    await timing.measure('image_model', async () => timing.attempt('image_model'));
    timing.hasReference = true;
    res.emit('finish');
    res.emit('close');
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.event, 'image_generation_timing');
    assert.equal(record.completion, 'finish');
    assert.equal(record.has_reference, true);
    assert.equal(record.story_model_attempts, 2);
    assert.equal(record.image_model_attempts, 1);
    for (const key of ['auth_ms', 'quota_ms', 'story_model_ms', 'image_model_ms', 'total_ms']) {
      assert.equal(typeof record[key], 'number');
      assert.ok(record[key] >= 0);
    }
    assert.deepEqual(Object.keys(record).sort(), [
      'auth_ms', 'completion', 'event', 'has_reference', 'image_model_attempts',
      'image_model_ms', 'quota_ms', 'status', 'story_fallback', 'story_model_attempts',
      'story_model_ms', 'total_ms', 'version',
    ].sort());
  } finally {
    console.info = original;
  }
});

test('records failed auth when the response finishes during the stage', async () => {
  const res = response();
  const lines: string[] = [];
  const original = console.info;
  console.info = (line: string) => lines.push(line);
  try {
    const timing = new ImageTiming(res);
    await assert.rejects(timing.measure('auth', async () => {
      res.statusCode = 401;
      res.emit('finish');
      throw new Error('test failure');
    }));
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.status, 401);
    assert.equal(typeof record.auth_ms, 'number');
    assert.equal(record.quota_ms, null);
    assert.equal(record.story_model_ms, null);
    assert.equal(record.image_model_ms, null);
  } finally {
    console.info = original;
  }
});

test('records a closed connection immediately while a stage is pending', async () => {
  const res = response();
  const lines: string[] = [];
  const original = console.info;
  console.info = (line: string) => lines.push(line);
  try {
    const timing = new ImageTiming(res);
    let resolve!: () => void;
    const pending = timing.measure('image_model', () => new Promise<void>(r => { resolve = r; }));
    timing.attempt('image_model');
    res.emit('close');
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.completion, 'close');
    assert.equal(record.image_model_ms, null);
    assert.equal(record.image_model_attempts, 1);
    resolve();
    await pending;
    res.emit('finish');
    assert.equal(lines.length, 1);
  } finally {
    console.info = original;
  }
});

test('records logical failure status after streaming starts', () => {
  const res = response();
  const lines: string[] = [];
  const original = console.info;
  console.info = (line: string) => lines.push(line);
  try {
    const timing = new ImageTiming(res);
    timing.responseStatus = 502;
    res.emit('finish');
    assert.equal(JSON.parse(lines[0]).status, 502);
  } finally {
    console.info = original;
  }
});
