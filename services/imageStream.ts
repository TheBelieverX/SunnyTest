import type { StoryBible } from './api';

export interface ImageResult {
  image: string;
  storyBible: StoryBible;
  used: number;
  quota: number;
}

export interface ModelPromptCounts {
  storyPromptChars: number;
  imagePromptChars: number;
}

function isStoryBible(value: unknown): value is StoryBible {
  if (!value || typeof value !== 'object') return false;
  return 'characters' in value && Array.isArray(value.characters)
    && value.characters.every((character: unknown) =>
      !!character && typeof character === 'object'
      && 'name' in character && typeof character.name === 'string'
      && 'description' in character && typeof character.description === 'string')
    && 'setting' in value && typeof value.setting === 'string'
    && 'style' in value && typeof value.style === 'string'
    && 'summary' in value && typeof value.summary === 'string';
}

export async function readImageStream(
  body: ReadableStream<Uint8Array>,
  onImageStarted: (counts?: ModelPromptCounts) => void,
): Promise<ImageResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: ImageResult | undefined;
  let started = false;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const event: unknown = JSON.parse(line);
    if (!event || typeof event !== 'object' || !('type' in event)) {
      throw new Error('Invalid image generation response');
    }
    if (event.type === 'image_started') {
      if (started || result) throw new Error('Invalid image generation response');
      started = true;
      if ('storyPromptChars' in event || 'imagePromptChars' in event) {
        if (!('storyPromptChars' in event) || !('imagePromptChars' in event)
          || !Number.isSafeInteger(event.storyPromptChars) || typeof event.storyPromptChars !== 'number' || event.storyPromptChars < 0
          || !Number.isSafeInteger(event.imagePromptChars) || typeof event.imagePromptChars !== 'number' || event.imagePromptChars < 0) {
          throw new Error('Invalid image generation response');
        }
        onImageStarted({ storyPromptChars: event.storyPromptChars, imagePromptChars: event.imagePromptChars });
      } else {
        onImageStarted();
      }
    } else if (event.type === 'error' && 'error' in event && typeof event.error === 'string') {
      throw new Error(event.error);
    } else if (event.type === 'result' && 'image' in event && typeof event.image === 'string'
      && 'storyBible' in event && isStoryBible(event.storyBible)
      && 'used' in event && typeof event.used === 'number'
      && 'quota' in event && typeof event.quota === 'number') {
      if (!started || result) throw new Error('Invalid image generation response');
      result = { image: event.image, storyBible: event.storyBible, used: event.used, quota: event.quota };
    } else {
      throw new Error('Invalid image generation response');
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        handleLine(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (done) break;
    }
    if (buffer.trim()) handleLine(buffer);
    if (!result) throw new Error('Image generation response ended before the image arrived');
    return result;
  } finally {
    reader.releaseLock();
  }
}
