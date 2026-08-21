import { writeFile } from "fs/promises";
import path from "path";
import { FiberConfig, normalizeFiberConfig } from "@/lib/fiberConfig";
import {
  adminErrorResponse,
  expectedAdminVersion,
  readGithubJson,
  readLocalJson,
  versionedJson,
  writeGithubJson,
  writeLocalJson,
} from "@/lib/adminVersionedJson";

function assertRawFiber(value: unknown): Partial<FiberConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Fiber settings source is not an object.");
  const data = value as Record<string, unknown>;
  for (const key of ["theme", "sections", "hero", "contact", "quote", "explanation", "process", "signup", "speedTest", "comparisonImages", "faq"]) {
    if (!data[key] || typeof data[key] !== "object" || Array.isArray(data[key])) throw new Error(`Fiber settings are missing ${key}.`);
  }
  const requireStrings = (record: Record<string, unknown>, keys: string[], label: string) => {
    for (const key of keys) {
      if (typeof record[key] !== "string") throw new Error(`Fiber settings ${label}.${key} must be a string.`);
    }
  };
  const requireBooleans = (record: Record<string, unknown>, keys: string[], label: string) => {
    for (const key of keys) {
      if (typeof record[key] !== "boolean") throw new Error(`Fiber settings ${label}.${key} must be a boolean.`);
    }
  };
  const requireStringArray = (raw: unknown, label: string, allowEmpty = true) => {
    if (!Array.isArray(raw) || (!allowEmpty && raw.length === 0) || raw.some(item => typeof item !== "string")) {
      throw new Error(`Fiber settings ${label} must be ${allowEmpty ? "an" : "a non-empty"} array of strings.`);
    }
  };
  const requireObject = (raw: unknown, label: string) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Fiber settings ${label} must be an object.`);
    return raw as Record<string, unknown>;
  };
  const requirePlan = (raw: unknown, label: string) => {
    const plan = requireObject(raw, label);
    requireStrings(plan, ["id", "name", "speed", "badge", "details"], label);
    if (!String(plan.id).trim() || !String(plan.name).trim() || typeof plan.price !== "number" || !Number.isFinite(plan.price)) {
      throw new Error(`Fiber settings ${label} is missing a valid id, name, or price.`);
    }
  };
  const requireAddon = (raw: unknown, label: string, requireId = false) => {
    const addon = requireObject(raw, label);
    requireStrings(addon, ["name", "description"], label);
    requireBooleans(addon, ["enabled", "selectedByDefault"], label);
    if (requireId && (typeof addon.id !== "string" || !addon.id.trim())) throw new Error(`Fiber settings ${label}.id is required.`);
    if (typeof addon.price !== "number" || !Number.isFinite(addon.price)) throw new Error(`Fiber settings ${label}.price must be a number.`);
    if (addon.channels !== undefined) requireStringArray(addon.channels, `${label}.channels`);
    if (addon.freeMonths !== undefined && (!Array.isArray(addon.freeMonths) || addon.freeMonths.some(item => typeof item !== "number"))) {
      throw new Error(`Fiber settings ${label}.freeMonths must be an array of numbers.`);
    }
  };

  const theme = data.theme as Record<string, unknown>;
  requireStrings(theme, ["accent", "accent2", "frontier", "ink", "font"], "theme");
  const sections = data.sections as Record<string, unknown>;
  requireBooleans(sections, ["hero", "quote", "explanation", "process", "signup", "speedTest", "comparisonImages", "faq", "contact"], "sections");
  requireStrings(data.hero as Record<string, unknown>, ["kicker", "headline", "body", "jjuNote", "photoUrl", "photoAlt", "cardNote"], "hero");
  requireStrings(data.contact as Record<string, unknown>, ["phoneLabel", "phoneHref", "email", "textBody"], "contact");

  const quote = data.quote as Record<string, unknown>;
  const faq = data.faq as Record<string, unknown>;
  if (!Array.isArray(quote.plans) || !quote.plans.length) throw new Error("Fiber settings must include at least one plan.");
  quote.plans.forEach((plan, index) => requirePlan(plan, `quote.plans[${index}]`));
  requireStrings(quote, ["eyebrow", "title", "defaultProviderId", "primaryPlanId", "disclaimer"], "quote");
  if (typeof quote.currentBillDefault !== "number" || !Number.isFinite(quote.currentBillDefault)) throw new Error("Fiber settings quote.currentBillDefault must be a number.");
  if (!Array.isArray(quote.currentBillPresets) || !quote.currentBillPresets.length || quote.currentBillPresets.some(item => typeof item !== "number")) {
    throw new Error("Fiber settings quote.currentBillPresets must be a non-empty array of numbers.");
  }
  requireAddon(quote.modem, "quote.modem");
  requireAddon(quote.youtubeTv, "quote.youtubeTv");
  const mastercard = requireObject(quote.mastercard, "quote.mastercard");
  requireStrings(mastercard, ["name", "description"], "quote.mastercard");
  requireBooleans(mastercard, ["enabled", "selectedByDefault"], "quote.mastercard");
  if (typeof mastercard.amount !== "number" || !Number.isFinite(mastercard.amount)) throw new Error("Fiber settings quote.mastercard.amount must be a number.");
  if (quote.providers !== undefined && (!Array.isArray(quote.providers) || !quote.providers.length)) {
    throw new Error("Fiber settings quote.providers must be a non-empty array when provided.");
  }
  (Array.isArray(quote.providers) ? quote.providers : []).forEach((rawProvider, providerIndex) => {
    const label = `quote.providers[${providerIndex}]`;
    const provider = requireObject(rawProvider, label);
    requireStrings(provider, ["id", "name", "badge", "serviceLabel", "planHeading", "summaryLabel", "primaryPlanId"], label);
    if (!String(provider.id).trim() || !Array.isArray(provider.plans) || !provider.plans.length || !Array.isArray(provider.addons)) {
      throw new Error(`Fiber settings ${label} is missing its id, plans, or addons.`);
    }
    provider.plans.forEach((plan, index) => requirePlan(plan, `${label}.plans[${index}]`));
    provider.addons.forEach((addon, index) => requireAddon(addon, `${label}.addons[${index}]`, true));
    const reward = requireObject(provider.reward, `${label}.reward`);
    requireStrings(reward, ["name", "description"], `${label}.reward`);
    requireBooleans(reward, ["enabled", "selectedByDefault"], `${label}.reward`);
    if (typeof reward.amount !== "number" || !Number.isFinite(reward.amount)) throw new Error(`Fiber settings ${label}.reward.amount must be a number.`);
    const promo = requireObject(provider.promo, `${label}.promo`);
    requireStrings(promo, ["name", "description"], `${label}.promo`);
    requireBooleans(promo, ["enabled", "appliesToBaseOnly"], `${label}.promo`);
    requireStringArray(promo.planIds, `${label}.promo.planIds`);
    if (!Array.isArray(promo.freeMonths) || promo.freeMonths.some(item => typeof item !== "number")) throw new Error(`Fiber settings ${label}.promo.freeMonths must be an array of numbers.`);
  });

  const explanation = data.explanation as Record<string, unknown>;
  requireStrings(explanation, ["title"], "explanation");
  requireStringArray(explanation.bullets, "explanation.bullets", false);
  const process = data.process as Record<string, unknown>;
  requireStrings(process, ["title"], "process");
  requireStringArray(process.steps, "process.steps", false);
  const signup = data.signup as Record<string, unknown>;
  requireStrings(signup, ["title", "body", "verificationNote"], "signup");
  requireStringArray(signup.requiredInfo, "signup.requiredInfo", false);
  const speedTest = data.speedTest as Record<string, unknown>;
  requireStrings(speedTest, ["title", "body"], "speedTest");
  if (!Array.isArray(speedTest.links)) throw new Error("Fiber settings speedTest.links must be an array.");
  speedTest.links.forEach((rawLink, index) => requireStrings(requireObject(rawLink, `speedTest.links[${index}]`), ["label", "url", "note"], `speedTest.links[${index}]`));
  const comparisonImages = data.comparisonImages as Record<string, unknown>;
  requireStrings(comparisonImages, ["title", "body"], "comparisonImages");
  if (!Array.isArray(comparisonImages.cards)) throw new Error("Fiber settings comparisonImages.cards must be an array.");
  comparisonImages.cards.forEach((rawCard, index) => requireStrings(requireObject(rawCard, `comparisonImages.cards[${index}]`), ["title", "imageUrl", "body"], `comparisonImages.cards[${index}]`));
  requireStrings(faq, ["title"], "faq");
  if (!Array.isArray(faq.items) || !faq.items.length) throw new Error("Fiber settings must include at least one FAQ item.");
  faq.items.forEach((rawItem, index) => requireStrings(requireObject(rawItem, `faq.items[${index}]`), ["question", "answer"], `faq.items[${index}]`));
  return value as Partial<FiberConfig>;
}

export async function GET() {
  try {
    const fiberPath = path.join(process.cwd(), "public", "fiber.json");
    const github = await readGithubJson("public/fiber.json");
    if (github) return versionedJson(normalizeFiberConfig(assertRawFiber(github.value)), github.version);
    const local = await readLocalJson(fiberPath);
    return versionedJson(normalizeFiberConfig(assertRawFiber(local.value)), local.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not load fiber settings.");
  }
}

export async function POST(request: Request) {
  try {
    const expectedVersion = expectedAdminVersion(request);
    const body = await request.json().catch(() => ({}));
    const config = normalizeFiberConfig(assertRawFiber(body.fiber || body));
    const content = `${JSON.stringify(config, null, 2)}\n`;
    const fiberPath = path.join(process.cwd(), "public", "fiber.json");
    const message = body.message || `Update fiber page settings (${new Date().toISOString().slice(0, 10)})`;

    const github = await writeGithubJson("public/fiber.json", content, message, expectedVersion);
    if (github) {
      try {
        await writeFile(fiberPath, content, "utf8");
      } catch {
        // Deployment files may be read-only; GitHub is the canonical successful write.
      }
      return versionedJson({ saved: true, target: "github", fiber: config }, github.version);
    }

    const local = await writeLocalJson(fiberPath, content, expectedVersion);
    return versionedJson({
      saved: true,
      target: "local",
      fiber: config,
      note: "Saved locally. Add GITHUB_TOKEN and GITHUB_REPO to save live through GitHub.",
    }, local.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not save fiber settings.");
  }
}
