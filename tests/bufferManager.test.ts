import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BufferManager, type GenerationRequest } from '../services/bufferManager.ts';
import { MAX_NARRATION_CHARS } from '../generationLimits.ts';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const text = (start: number, end: number) => Array.from({ length: end - start }, (_, i) => `word${start + i}`).join(' ');

test('final results are preferred over repeated interim revisions', async () => {
  const buffer = new BufferManager(30);
  const requests: GenerationRequest[] = [];
  buffer.onGenerationRequest = request => requests.push(request);
  buffer.addText(text(0, 70), '1:0', false);
  buffer.addText(text(0, 80), '1:0', false);
  assert.equal(requests.length, 0);
  buffer.addText(text(0, 80), '1:0', true);
  await delay(50);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].sourceText, text(0, 80));
});

test('fallback commits interim once and final results only add new speech', async () => {
  const buffer = new BufferManager(20);
  const requests: GenerationRequest[] = [];
  buffer.onGenerationRequest = request => requests.push(request);
  buffer.addText(text(0, 70), '1:0', false);
  await delay(40);
  assert.equal(requests[0].sourceText, text(0, 70));
  for (let end = 71; end <= 145; end++) buffer.addText(text(0, end), '1:0', false);
  buffer.addText(text(0, 145), '1:0', true);
  buffer.completeGeneration(requests[0].id);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].sourceText, text(70, 145));
});

test('recognition restart commits unsent interim speech and cancels fallback', async () => {
  const buffer = new BufferManager(20);
  const requests: GenerationRequest[] = [];
  buffer.onGenerationRequest = request => requests.push(request);
  buffer.addText(text(0, 40), '1:0', false);
  buffer.finishRecognition();
  buffer.addText(text(40, 70), '2:0', true);
  await delay(40);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].sourceText, text(0, 70));
});

test('long and queued narration is split without loss at the API limit', () => {
  const buffer = new BufferManager();
  const requests: GenerationRequest[] = [];
  buffer.onGenerationRequest = request => requests.push(request);
  const chunks = [text(0, 70), text(70, 1400), text(1400, 2200)];
  chunks.forEach((chunk, index) => buffer.addText(chunk, `1:${index}`, true));
  for (let i = 0; i < requests.length; i++) buffer.completeGeneration(requests[i].id);
  assert.ok(requests.length > 3);
  assert.ok(requests.every(request => request.sourceText.length <= MAX_NARRATION_CHARS));
  assert.equal(requests.map(request => request.sourceText).join(' '), chunks.join(' '));
});

test('fallback tracks an anchored boundary after an earlier word is corrected', async () => {
  const buffer = new BufferManager(20);
  const requests: GenerationRequest[] = [];
  buffer.onGenerationRequest = request => requests.push(request);
  buffer.addText(text(0, 70), '1:0', false);
  await delay(40);
  buffer.addText(`changed extra ${text(1, 140)}`, '1:0', true);
  buffer.completeGeneration(requests[0].id);
  assert.equal(requests[1].sourceText, text(70, 140));
});

test('multiple fallback cycles only add newly spoken words', async () => {
  const buffer = new BufferManager(20);
  const requests: GenerationRequest[] = [];
  buffer.onGenerationRequest = request => requests.push(request);
  buffer.addText(text(0, 70), '1:0', false);
  await delay(40);
  for (let end = 71; end <= 140; end++) buffer.addText(text(0, end), '1:0', false);
  await delay(40);
  buffer.addText(text(0, 210), '1:0', true);
  for (let i = 0; i < requests.length; i++) buffer.completeGeneration(requests[i].id);
  assert.equal(requests.map(request => request.sourceText).join(' '), text(0, 210));
});

test('warns once when a revision removes the committed anchor', async () => {
  const buffer = new BufferManager(20);
  let warnings = 0;
  buffer.onWarning = () => warnings++;
  buffer.addText(text(0, 70), '1:0', false);
  await delay(40);
  buffer.addText(text(100, 175), '1:0', false);
  buffer.addText(text(100, 176), '1:0', false);
  assert.equal(warnings, 1);
  buffer.reset();
});

test('reset cancels the fallback without emitting stale narration', async () => {
  const buffer = new BufferManager(20);
  const requests: GenerationRequest[] = [];
  buffer.onGenerationRequest = request => requests.push(request);
  buffer.addText(text(0, 70), '1:0', false);
  buffer.reset();
  await delay(40);
  assert.equal(requests.length, 0);
});
