import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin, requireUser } from './_lib/server.js';

const CATEGORIES = new Set(['bug', 'idea', 'other']);
const MAX_MESSAGE_LENGTH = 1000;
const MAX_SUBMISSIONS_PER_HOUR = 5;
const WINDOW_MS = 60 * 60 * 1000;

// Postgres rejects NUL characters, and PostgREST rejects unpaired surrogates.
const INVALID_TEXT = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const fail = (res: VercelResponse, status: number, error: string) => res.status(status).json({ error });

async function submit(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Method not allowed');
  }

  const user = await requireUser(req, res);
  if (!user) return;

  if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
    return fail(res, 400, 'Invalid request body');
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(res, 400, 'Invalid request body');

  const { category, message, rating, followUp } = body;
  if (typeof category !== 'string' || !CATEGORIES.has(category)) {
    return fail(res, 400, 'Choose a valid feedback type');
  }
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text || text.length > MAX_MESSAGE_LENGTH || INVALID_TEXT.test(text)) {
    return fail(res, 400, `Message must be between 1 and ${MAX_MESSAGE_LENGTH} valid characters`);
  }
  if (rating !== null && rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return fail(res, 400, 'Rating must be between 1 and 5');
  }
  if (followUp !== undefined && typeof followUp !== 'boolean') {
    return fail(res, 400, 'Follow-up preference must be a boolean');
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('is_blocked')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (profile?.is_blocked) return fail(res, 403, 'Account blocked');

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const recentCount = async () => {
    const { count, error } = await admin
      .from('feedback')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since);
    if (error) throw error;
    return count ?? 0;
  };

  if ((await recentCount()) >= MAX_SUBMISSIONS_PER_HOUR) {
    return fail(res, 429, 'Feedback limit reached. Please try again later.');
  }

  const { data: row, error: insertError } = await admin
    .from('feedback')
    .insert({
      user_id: user.id,
      category,
      message: text,
      rating: rating ?? null,
      follow_up: followUp ?? false,
    })
    .select('id')
    .single();
  if (insertError) throw insertError;

  // Concurrent requests can all pass the check above, so verify after inserting and
  // withdraw this row if it pushed the user over the limit. The limit can never be exceeded.
  if ((await recentCount()) > MAX_SUBMISSIONS_PER_HOUR) {
    const { error: deleteError } = await admin.from('feedback').delete().eq('id', row.id);
    if (deleteError) console.error('Failed to withdraw over-limit feedback:', deleteError);
    return fail(res, 429, 'Feedback limit reached. Please try again later.');
  }

  return res.status(201).json({ ok: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    return await submit(req, res);
  } catch (error) {
    // Vercel throws a 400 error when the request body is not valid JSON.
    if ((error as { statusCode?: number })?.statusCode === 400) return fail(res, 400, 'Invalid request body');
    console.error('Feedback request failed:', error);
    return fail(res, 500, 'Could not submit feedback');
  }
}
