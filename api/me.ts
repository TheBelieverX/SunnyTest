import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin, requireUser } from './_lib/server.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await requireUser(req, res);
  if (!user) return;
  const { data } = await admin
    .from('profiles')
    .select('images_used, image_quota, is_blocked')
    .eq('id', user.id)
    .single();
  return res.status(200).json({
    used: data?.images_used ?? 0,
    quota: data?.image_quota ?? 200,
    blocked: data?.is_blocked ?? false,
  });
}
