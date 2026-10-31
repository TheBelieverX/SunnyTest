import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin, requireUser } from './_lib/server.js';

const ALLOWED = new Set(['session_start', 'listening_start', 'listening_stop', 'reading_heartbeat', 'page_view']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;

  const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 20) : [];
  const rows = events
    .filter((e: any) => e && ALLOWED.has(e.type))
    .map((e: any) => {
      const seconds = Math.min(Math.max(Number(e.meta?.seconds) || 0, 0), 120);
      return {
        user_id: user.id,
        type: e.type,
        meta: e.type === 'reading_heartbeat' ? { seconds } : {},
      };
    });

  if (rows.length) await admin.from('usage_events').insert(rows);
  return res.status(200).json({ ok: true });
}
