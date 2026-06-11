import { NextResponse } from "next/server";
import { callAnthropic, DEFAULT_FACT_MODEL, textJson } from "@/lib/anthropic";
import { normalizeReviewNote, type ReviewNote } from "@/lib/review";

type FactBody = {
  claims?: ReviewNote[];
  chapterPath?: string;
  bookName?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as FactBody;
    const bookName = String(body.bookName || "");
    const chapterPath = String(body.chapterPath || "");
    const claims = (Array.isArray(body.claims) ? body.claims : []).slice(0, 32).map(claim => ({
      line: claim.line,
      claim: claim.claim || claim.line,
      issue: claim.issue,
      category: claim.category,
      risk: claim.risk,
    }));

    const result = await callAnthropic({
      model: process.env.ANTHROPIC_FACT_MODEL || DEFAULT_FACT_MODEL,
      max_tokens: 9000,
      system: [
        "You are a careful editorial fact-checker for a book editor.",
        "Use web search only when needed, and keep searches sparse.",
        "Flag only concrete likely factual problems, missing-source claims, or cooked paragraphs that are too risky as written.",
        "For each issue, recommend the smallest possible replacement that keeps the original rhythm, framing, tone, and sentence shape.",
        "If the original is mostly fine, leave fix empty and explain what source would support it.",
        "Do not rewrite for style. Do not over-police metaphor, opinion, narrative, or literary compression.",
        "Return JSON only with an issues array.",
      ].join(" "),
      messages: [{
        role: "user",
        content: JSON.stringify({
          bookName,
          chapterPath,
          claims,
          requiredShape: {
            issues: [{
              line: "exact original line or paragraph",
              issue: "what is wrong, risky, or source-needed",
              fix: "minimal replacement, as close to original as possible",
              type: "error | source | review",
              confidence: "low | medium | high",
              source: { title: "source title", url: "https://...", relationship: "supports | contradicts | context" },
            }],
          },
        }),
      }],
      tools: [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: Number(process.env.ANTHROPIC_WEB_SEARCH_MAX_USES || 2),
      }],
    });

    const parsed = textJson(result);
    const issues = (Array.isArray(parsed.issues) ? parsed.issues : []).map((issue: Record<string, unknown>) => normalizeReviewNote({
      ...issue,
      bookName,
      chapterPath,
      status: "open",
    }));

    return NextResponse.json({ issues });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fact-checking failed." },
      { status: 500 },
    );
  }
}
