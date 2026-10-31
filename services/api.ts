import { useEffect, useState } from 'react';
import { supabase } from './supabase';

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

export async function authFetch(path: string, body?: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function refreshUsage() {
  try {
    const res = await authFetch('/api/me');
    if (res.ok) setUsage(await res.json());
  } catch { /* offline: keep the last known value */ }
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
  previousImage: string | null
): Promise<{ image: string; storyBible: StoryBible }> {
  const res = await authFetch('/api/generate-image', { description, storyBible, previousImage });
  const json = await res.json().catch(() => ({}));
  if (res.status === 429) {
    setUsage({ used: json.used, quota: json.quota });
    throw new QuotaExceededError();
  }
  if (!res.ok) throw new Error(json.error || 'Image generation failed');
  setUsage({ used: json.used, quota: json.quota });
  return { image: json.image, storyBible: json.storyBible };
}

export function track(type: string, meta?: Record<string, unknown>) {
  authFetch('/api/track', { events: [{ type, meta }] }).catch(() => {});
}
