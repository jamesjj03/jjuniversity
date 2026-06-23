import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/account";
  return value;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const authError = requestUrl.searchParams.get("error_description") || requestUrl.searchParams.get("error");
  const next = safeNextPath(requestUrl.searchParams.get("next"));

  if (authError) {
    const redirect = new URL(next, requestUrl.origin);
    redirect.searchParams.set("auth", "error");
    redirect.searchParams.set("message", authError);
    return NextResponse.redirect(redirect);
  }

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
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

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const redirect = new URL(next, requestUrl.origin);
      redirect.searchParams.set("auth", "error");
      redirect.searchParams.set("message", error.message);
      return NextResponse.redirect(redirect);
    }
  }

  const redirect = new URL(next, requestUrl.origin);
  redirect.searchParams.set("auth", code ? "confirmed" : "missing-code");
  return NextResponse.redirect(redirect);
}
