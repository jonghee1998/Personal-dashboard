import { createBrowserClient } from '@supabase/ssr';

// Browser-side client. Never import next/headers or service-role keys here.
export function browserDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase public environment variables are missing');
  return createBrowserClient(url, anon);
}
