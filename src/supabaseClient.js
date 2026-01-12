import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Mancano VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY nelle env vars.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
