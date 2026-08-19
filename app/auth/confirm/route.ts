import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { safeAuthReturnPath } from "@/lib/authReturnPath";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const next = safeAuthReturnPath(requestUrl.searchParams.get("next"), "/account", requestUrl.origin);
  const redirect = new URL(next, requestUrl.origin);

  if (!tokenHash || !type) {
    redirect.searchParams.set("auth", "missing-code");
    return NextResponse.redirect(redirect);
  }

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

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    redirect.searchParams.set("auth", "error");
    redirect.searchParams.set("message", error.message);
    return NextResponse.redirect(redirect);
  }

  redirect.searchParams.set("auth", type === "recovery" ? "recovery" : "confirmed");
  return NextResponse.redirect(redirect);
}
