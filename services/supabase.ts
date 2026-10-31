import { createClient } from '@supabase/supabase-js';

// Read before the client initialises, because it strips the auth tokens from the URL.
const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
export const initialLinkType = hash.get('type');
export const initialLinkError = hash.get('error_description');

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
