export const DEFAULT_CLAIM_MODEL = "claude-3-5-haiku-20241022";
export const DEFAULT_FACT_MODEL = "claude-sonnet-4-20250514";

type AnthropicBody = {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string | unknown[] }>;
  tools?: unknown[];
  tool_choice?: unknown;
};

export async function callAnthropic(body: AnthropicBody) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Set ANTHROPIC_API_KEY before running Claude review tools.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message || "Claude request failed.");
  return json;
}

export function toolInput(result: Record<string, unknown>, name: string) {
  const content = Array.isArray(result.content) ? result.content : [];
  const tool = content.find(item => item && typeof item === "object" && (item as { type?: string; name?: string }).type === "tool_use" && (item as { name?: string }).name === name) as { input?: unknown } | undefined;
  if (!tool?.input || typeof tool.input !== "object") throw new Error("Claude did not return structured review data.");
  return tool.input as Record<string, unknown>;
}

export function textJson(result: Record<string, unknown>) {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter(item => item && typeof item === "object" && (item as { type?: string }).type === "text")
    .map(item => (item as { text?: string }).text || "")
    .join("\n")
    .trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return JSON.parse(fenced || text);
}
