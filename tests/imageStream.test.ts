import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readImageStream } from '../services/imageStream.ts';

const image = { image: 'data:image/png;base64,abc', storyBible: { characters: [], setting: '', style: '', summary: '' }, used: 1, quota: 10 };
const encode = (value: string) => new TextEncoder().encode(value);

test('signals model start before returning a result across chunk boundaries', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  let starts = 0;
  const result = readImageStream(stream, () => { starts++; });
  controller.enqueue(encode('{"type":"image_'));
  controller.enqueue(encode('started"}\n'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(starts, 1);
  const encoded = encode(`${JSON.stringify({ type: 'result', ...image })}\n`);
  controller.enqueue(encoded.slice(0, 20));
  controller.enqueue(encoded.slice(20));
  controller.close();
  assert.deepEqual(await result, image);
});

test('reports streamed failures and incomplete responses', async () => {
  for (const [body, message] of [
    ['{"type":"image_started"}\n{"type":"error","error":"provider failed"}\n', 'provider failed'],
    ['{"type":"image_started"}\n', 'ended before the image arrived'],
    ['{"type":"result"}\n', 'Invalid image generation response'],
  ]) {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encode(body)); controller.close(); },
    });
    await assert.rejects(readImageStream(stream, () => {}), new RegExp(message));
  }
});

test('reports model prompt lengths when the image stage starts', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode(`{"type":"image_started","storyPromptChars":1234,"imagePromptChars":567}\n${JSON.stringify({ type: 'result', ...image })}\n`));
      controller.close();
    },
  });
  let counts: { storyPromptChars: number; imagePromptChars: number } | undefined;
  assert.deepEqual(await readImageStream(stream, value => { counts = value; }), image);
  assert.deepEqual(counts, { storyPromptChars: 1234, imagePromptChars: 567 });
});

test('rejects invalid prompt counts', async () => {
  for (const event of [
    { type: 'image_started', storyPromptChars: 1 },
    { type: 'image_started', storyPromptChars: -1, imagePromptChars: 2 },
    { type: 'image_started', storyPromptChars: 1, imagePromptChars: 1.5 },
  ]) {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encode(`${JSON.stringify(event)}\n`)); controller.close(); },
    });
    await assert.rejects(readImageStream(stream, () => {}), /Invalid image generation response/);
  }
});
