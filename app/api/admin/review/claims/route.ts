import { NextResponse } from "next/server";
import { callAnthropic, DEFAULT_CLAIM_MODEL, toolInput } from "@/lib/anthropic";
import { extractReviewBlocks, normalizeReviewNote } from "@/lib/review";

type ClaimBody = {
  text?: string;
  chapterPath?: string;
  bookName?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as ClaimBody;
    const bookName = String(body.bookName || "");
    const chapterPath = String(body.chapterPath || "");
    const blocks = extractReviewBlocks(body.text || "").slice(0, 220);

    const result = await callAnthropic({
      model: process.env.ANTHROPIC_CLAIM_MODEL || DEFAULT_CLAIM_MODEL,
      max_tokens: 9000,
      system: [
        "You split book text into reviewable editorial blocks and claims.",
        "Do not fact-check yet.",
        "Classify every meaningful block as factual, interpretive, opinion, metaphor, narrative, style, or other.",
        "Extract only claims that are source-worthy: factual, date-based, biographical, scientific, historical, legal, medical, financial, or otherwise checkable.",
        "Also flag cooked/risky paragraphs when the whole block is too broad, loaded, under-sourced, or likely misleading.",
        "Do not flatten the author's voice. Minimal changes only, and only when accuracy requires it.",
      ].join(" "),
      messages: [{
        role: "user",
        content: JSON.stringify({ bookName, chapterPath, blocks }),
      }],
      tools: [{
        name: "submit_claim_split",
        description: "Submit classified blocks and source-worthy claims for human review.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["blocks", "claims"],
          properties: {
            blocks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["blockId", "kind", "risk", "needsSource", "text", "why"],
                properties: {
                  blockId: { type: "number" },
                  kind: { type: "string", enum: ["factual", "interpretive", "opinion", "metaphor", "narrative", "style", "other"] },
                  risk: { type: "string", enum: ["low", "medium", "high"] },
                  needsSource: { type: "boolean" },
                  text: { type: "string" },
                  why: { type: "string" },
                },
              },
            },
            claims: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["blockId", "line", "claim", "category", "risk", "needsSource", "why"],
                properties: {
                  blockId: { type: "number" },
                  line: { type: "string" },
                  claim: { type: "string" },
                  category: { type: "string", enum: ["factual", "interpretive", "date", "biographical", "scientific", "historical", "legal", "medical", "financial", "cooked-block", "other"] },
                  risk: { type: "string", enum: ["low", "medium", "high"] },
                  needsSource: { type: "boolean" },
                  why: { type: "string" },
                },
              },
            },
          },
        },
      }],
      tool_choice: { type: "tool", name: "submit_claim_split" },
    });

    const parsed = toolInput(result, "submit_claim_split");
    const reviewBlocks = (Array.isArray(parsed.blocks) ? parsed.blocks : []).map((block: Record<string, unknown>) => ({ ...block, bookName, chapterPath }));
    const claims = (Array.isArray(parsed.claims) ? parsed.claims : []).map((claim: Record<string, unknown>) => normalizeReviewNote({
      ...claim,
      issue: String(claim.why || ""),
      type: claim.needsSource ? "source" : "review",
      status: "open",
      bookName,
      chapterPath,
    }));

    return NextResponse.json({ blocks: reviewBlocks, claims });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Claim splitting failed." },
      { status: 500 },
    );
  }
}
