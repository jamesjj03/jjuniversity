import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function DELETE() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.json({ error: "Supabase auth is not configured." }, { status: 503 });
  }

  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({ error: "Account deletion is not configured." }, { status: 503 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: "Sign in before deleting an account." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const result = await admin.auth.admin.deleteUser(data.user.id);
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
