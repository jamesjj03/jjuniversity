import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

export function hasSupabaseServerConfig() {
  return Boolean(supabaseUrl && supabasePublishableKey);
}
export async function createSupabaseRequestClient() {
  if (!hasSupabaseServerConfig()) {
    throw new Error("Missing Supabase server environment variables.");
  }

  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write response cookies. Route Handlers can,
          // and the browser client will refresh the session on the next request.
        }
      },
    },
  });
}
