import { NextResponse } from "next/server";
import { DEFAULT_CLAIM_MODEL, DEFAULT_FACT_MODEL } from "@/lib/anthropic";

export async function GET() {
  return NextResponse.json({
    provider: "Anthropic Claude",
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    claimModel: process.env.ANTHROPIC_CLAIM_MODEL || DEFAULT_CLAIM_MODEL,
    factModel: process.env.ANTHROPIC_FACT_MODEL || DEFAULT_FACT_MODEL,
    webSearchMaxUses: Number(process.env.ANTHROPIC_WEB_SEARCH_MAX_USES || 2),
  });
}
