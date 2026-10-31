import { GoogleGenAI } from '@google/genai';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin, requireUser } from './_lib/server.js';

const MAX_TEXT = 4000;
const MAX_IMAGE_B64 = 1_500_000;
const DEFAULT_STYLE = "friendly, soft children's-book digital illustration with vibrant colors";

interface StoryBible {
  characters: { name: string; description: string }[];
  setting: string;
  style: string;
  summary: string;
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

function sanitizeBible(raw: any): StoryBible {
  const characters = Array.isArray(raw?.characters) ? raw.characters.slice(0, 20) : [];
  return {
    characters: characters
      .map((c: any) => {
        const description = clip(c?.description, 400);
        const name = clip(c?.name, 80).trim() || description.split(/[:,.]/)[0].slice(0, 60).trim();
        return { name, description };
      })
      .filter((c: any) => c.name && c.description),
    setting: clip(raw?.setting, 400),
    style: clip(raw?.style, 300) || DEFAULT_STYLE,
    summary: clip(raw?.summary, 1200),
  };
}

// Rate-limit (429) backoff; anything else fails immediately.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if ((err as any)?.status !== 429 || attempt >= 3) throw err;
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1) + Math.random() * 1000));
    }
  }
}

// A text model keeps a persistent character sheet and turns the new narration into a concrete scene.
// If it fails, fall back to the raw narration so image generation still works.
async function updateBible(ai: GoogleGenAI, bible: StoryBible, text: string): Promise<{ bible: StoryBible; scene: string }> {
  const prompt = `
You maintain a "story bible" for an illustrated children's story that is being told aloud. The text may be Romanian or English and comes from speech-to-text, so it may contain mistakes.

CURRENT STORY BIBLE (JSON):
${JSON.stringify(bible)}

NEW NARRATION:
"""${text}"""

Return ONLY JSON: {"characters":[{"name":"short label, e.g. Unicorns or Luna the fox","description":"visual description"}],"setting":"","style":"","summary":"","scene":""}

Rules:
- Every character MUST have a non-empty "name" and "description".
- Keep every existing character exactly as established: same species/type (e.g. unicorns stay unicorns, never humans), same number of individuals, same colors, clothing and features. Change a character only if the narration explicitly says it changes (transformation, new outfit, etc.).
- Add new characters introduced by the narration. A group is ONE entry that states the count (e.g. "Three unicorns: ...").
- Resolve pronouns and references ("they", "he", "the creatures") to the established characters.
- "description" must be a visual description in English: species/type, count, colors, clothing, notable features.
- Keep "style" as is unless empty; then use: "${DEFAULT_STYLE}".
- "setting": the current location in English.
- "summary": a short English summary (max 4 sentences) of the whole story so far.
- "scene": 2-4 English sentences describing exactly what the next illustration shows, naming the characters with their full visual description.
`.trim();

  try {
    const r = await withRetry(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.2 },
    }));
    const json = JSON.parse(r.text || '');
    const scene = clip(json.scene, 1200);
    if (!scene) throw new Error('empty scene');
    return { bible: sanitizeBible(json), scene };
  } catch (e) {
    console.error('Story bible update failed, falling back to raw text:', e);
    return { bible, scene: text };
  }
}

class GenerationError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Gemini SDK errors carry a JSON body; pull out a short readable reason.
function describeUpstream(e: unknown): string {
  const status = (e as any)?.status;
  const raw = e instanceof Error ? e.message : String(e);
  let msg = raw;
  try { msg = JSON.parse(raw)?.error?.message ?? raw; } catch { /* not JSON */ }
  return `${status ? `HTTP ${status}: ` : ''}${msg.split('\n')[0]}`.slice(0, 240);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const { description, storyBible, previousImage } = req.body || {};
  if (typeof description !== 'string' || !description.trim() || description.length > MAX_TEXT) {
    return res.status(400).json({ error: 'Invalid description' });
  }
  const bible = sanitizeBible(storyBible);
  const prevMatch = typeof previousImage === 'string' && previousImage.length < MAX_IMAGE_B64
    ? previousImage.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
    : null;

  // Reserve a credit before spending money on Gemini.
  const { data: credit, error: creditErr } = await admin.rpc('consume_image_credit', { p_user: user.id });
  if (creditErr || !credit?.[0]) return res.status(500).json({ error: 'Quota check failed' });
  const { ok, used, quota } = credit[0];
  if (!ok) {
    return res.status(429).json({ error: 'Image limit reached', code: 'QUOTA_EXCEEDED', used, quota });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const { bible: updatedBible, scene } = await updateBible(ai, bible, description.trim());

    const characterSheet = updatedBible.characters
      .map(c => `- ${c.name}: ${c.description}`)
      .join('\n') || '- (none established yet)';

    const prompt = `
Create a colorful children's book illustration (friendly, soft digital art, vibrant but pleasing colors, detailed but not cluttered, suitable for a 7-year-old).

SCENE TO ILLUSTRATE:
${scene}

STORY SO FAR: ${updatedBible.summary || 'The story is just beginning.'}
SETTING: ${updatedBible.setting || 'not specified'}
ART STYLE: ${updatedBible.style}

CHARACTER SHEET - these characters are fixed and must look exactly like this:
${characterSheet}

STRICT RULES:
- Draw every character exactly as described above: same species/type, same number of individuals, same colors and clothing.
- NEVER turn creatures or animals into humans (or the reverse), and never add, remove or swap characters unless the SCENE says so explicitly.
- Keep the same art style, color palette and setting as the story so far.
${prevMatch ? '- A reference image of the previous scene is attached. Keep the same characters, character designs and art style as in that image.' : ''}
`.trim();

    const parts: any[] = [];
    if (prevMatch) parts.push({ inlineData: { mimeType: prevMatch[1], data: prevMatch[2] } });
    parts.push({ text: prompt });

    const response = await withRetry(() => ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts },
    }));

    const candidate = response.candidates?.[0];
    const part = candidate?.content?.parts?.find(p => p.inlineData);
    if (!part?.inlineData?.data) {
      const text = candidate?.content?.parts?.map(p => p.text).filter(Boolean).join(' ').slice(0, 200);
      const reason = response.promptFeedback?.blockReason
        ? `prompt blocked (${response.promptFeedback.blockReason})`
        : `no image returned (finishReason: ${candidate?.finishReason ?? 'none'}${text ? `, model said: "${text}"` : ''})`;
      throw new GenerationError(reason, 422);
    }

    await admin.from('usage_events').insert({
      user_id: user.id,
      type: 'image_generated',
      meta: { chars: description.length },
    });

    return res.status(200).json({
      image: `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`,
      storyBible: updatedBible,
      used,
      quota,
    });
  } catch (e) {
    await admin.rpc('refund_image_credit', { p_user: user.id });
    console.error('Image generation failed:', e);
    const status = e instanceof GenerationError ? e.status : (e as any)?.status;
    const detail = e instanceof GenerationError ? e.message : describeUpstream(e);
    await admin.from('usage_events').insert({
      user_id: user.id,
      type: 'image_failed',
      meta: { status: status ?? null, detail },
    });
    return res.status(502).json({ error: `Image generation failed: ${detail}` });
  }
}
