import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { readImageStream, type ModelPromptCounts } from './imageStream';

export interface Usage { used: number; quota: number }

export class QuotaExceededError extends Error {
  constructor() { super('Image limit reached'); }
}

let usage: Usage | null = null;
const listeners = new Set<(u: Usage | null) => void>();
const setUsage = (u: Usage | null) => { usage = u; listeners.forEach(l => l(u)); };

export function useUsage() {
  const [u, setU] = useState<Usage | null>(usage);
  useEffect(() => { listeners.add(setU); return () => { listeners.delete(setU); }; }, []);
  return u;
}

export async function authFetch(path: string, body?: unknown, signal?: AbortSignal, accept?: string): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}`, ...(accept ? { Accept: accept } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}

export async function refreshUsage(retries = 3) {
  try {
    const res = await authFetch('/api/me');
    if (res.ok) return setUsage(await res.json());
  } catch { /* fall through to retry */ }
  if (retries > 0) setTimeout(() => refreshUsage(retries - 1), 2000);
}

export interface StoryBible {
  characters: { name: string; description: string }[];
  setting: string;
  style: string;
  summary: string;
}

// Shrinks the previous picture so it can be sent back as a small visual reference.
export function downscaleImage(dataUrl: string, maxSide = 512): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export async function generateImageViaApi(
  description: string,
  storyBible: StoryBible | null,
  previousImage: string | null,
  onImageStarted: (counts?: ModelPromptCounts) => void,
): Promise<{ image: string; storyBible: StoryBible }> {
  // The server reserves the credit when the request starts, so count it immediately.
  if (usage) setUsage({ ...usage, used: Math.min(usage.used + 1, usage.quota) });
  try {
    const res = await authFetch('/api/generate-image', { description, storyBible, previousImage }, AbortSignal.timeout(90_000), 'application/x-ndjson');
    if (res.ok && res.headers.get('content-type')?.includes('application/x-ndjson')) {
      if (!res.body) throw new Error('Image generation response has no body');
      const result = await readImageStream(res.body, onImageStarted);
      setUsage({ used: result.used, quota: result.quota });
      return { image: result.image, storyBible: result.storyBible };
    }
    const json = await res.json();
    if (res.status === 429) {
      setUsage({ used: json.used, quota: json.quota });
      throw new QuotaExceededError();
    }
    if (!res.ok) throw new Error(json.error || 'Image generation failed');
    setUsage({ used: json.used, quota: json.quota });
    return { image: json.image, storyBible: json.storyBible };
  } catch (e) {
    if (!(e instanceof QuotaExceededError)) refreshUsage();
    throw e instanceof Error && e.name === 'TimeoutError' ? new Error('Image generation timed out') : e;
  }
}

export function track(type: string, meta?: Record<string, unknown>) {
  authFetch('/api/track', { events: [{ type, meta }] }).catch(() => {});
}
