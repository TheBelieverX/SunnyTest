import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Validates the Supabase JWT from the Authorization header. Responds 401 and returns null on failure.
export async function requireUser(req: VercelRequest, res: VercelResponse) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid session' });
    return null;
  }
  return data.user;
}
