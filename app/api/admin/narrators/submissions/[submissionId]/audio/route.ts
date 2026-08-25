import { NextResponse } from "next/server";
import {
  createNarratorSubmissionListenUrl,
  NarratorAdminInputError,
} from "@/lib/narratorAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = {
  params: Promise<{ submissionId: string }>;
};

function unavailable(status = 404) {
  return NextResponse.json(
    { error: "Recording is not available." },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
      },
    },
  );
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { submissionId } = await params;
    const url = await createNarratorSubmissionListenUrl(submissionId);
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    return response;
  } catch (error) {
    return unavailable(error instanceof NarratorAdminInputError ? 404 : 503);
  }
}
