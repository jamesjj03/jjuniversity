import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function hasSupabaseAdminConfig() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

export function createSupabaseAdminClient() {
  if (!hasSupabaseAdminConfig()) {
    throw new Error("Missing Supabase admin environment variables.");
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
