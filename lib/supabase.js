// Shared Supabase client for the whole app.
// Usage in any page or component:
//   import { supabase } from "@/lib/supabase";
// The URL and anon key are read from .env.local (never commit that file).
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase keys. Create .env.local with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart npm run dev."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
