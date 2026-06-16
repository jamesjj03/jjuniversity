import {
  getPrintProductComponents,
  getPrintProductPageCount,
  type PrintProduct,
} from "@/lib/publishing";

const LULU_TOKEN_PATH = "/auth/realms/glasstree/protocol/openid-connect/token";
const DEFAULT_LULU_API_BASE_URL = "https://api.sandbox.lulu.com";

export type LuluShippingLevel = "MAIL" | "PRIORITY_MAIL" | "GROUND_HD" | "GROUND_BUS" | "GROUND" | "EXPRESS";

export type LuluShippingAddress = {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state_code: string;
  postcode: string;
  country_code: string;
  phone_number: string;
  email?: string;
};

export type LuluPreparedLineItem = {
  productSlug: string;
  title: string;
  quantity: number;
  pageCount: number;
  podPackageId: string;
  publicInteriorUrl: string;
  publicCoverUrl: string;
};

export type LuluReadiness = {
  ready: boolean;
  missing: string[];
  lineItems: LuluPreparedLineItem[];
};

export type LuluCostCalculationPayload = {
  currency: "USD";
  line_items: Array<{
    page_count: number;
    pod_package_id: string;
    quantity: number;
  }>;
  shipping_address: LuluShippingAddress;
  shipping_option: LuluShippingLevel;
};

export type LuluPrintJobPayload = {
  contact_email: string;
  external_id: string;
  line_items: Array<{
    external_id: string;
    printable_normalization: {
      cover: { source_url: string };
      interior: { source_url: string };
      pod_package_id: string;
    };
    quantity: number;
    title: string;
  }>;
  production_delay?: number;
  shipping_address: LuluShippingAddress;
  shipping_level: LuluShippingLevel;
};

export class LuluReadinessError extends Error {
  missing: string[];
  readiness: LuluReadiness;

  constructor(message: string, readiness: LuluReadiness) {
    super(message);
    this.name = "LuluReadinessError";
    this.missing = readiness.missing;
    this.readiness = readiness;
  }
}

export function getLuluConfigStatus() {
  const missing: string[] = [];
  if (!process.env.LULU_CLIENT_KEY) missing.push("LULU_CLIENT_KEY");
  if (!process.env.LULU_CLIENT_SECRET) missing.push("LULU_CLIENT_SECRET");
  return {
    configured: missing.length === 0,
    missing,
    apiBaseUrl: getLuluApiBaseUrl(),
  };
}

export function hasLuluConfig() {
  return getLuluConfigStatus().configured;
}

export function shouldAutoSubmitLuluJobs() {
  return String(process.env.LULU_AUTO_SUBMIT_PRINT_JOBS || "").toLowerCase() === "true";
}

export function getLuluReadiness(product: PrintProduct): LuluReadiness {
  const products = getLuluShipmentProducts(product);
  const missing: string[] = [];
  const lineItems = products.map(item => {
    const pageCount = getPrintProductPageCount(item).pages;
    const prepared: LuluPreparedLineItem = {
      productSlug: item.slug,
      title: item.title,
      quantity: 1,
      pageCount,
      podPackageId: String(item.podPackageId || "").trim(),
      publicInteriorUrl: String(item.publicInteriorUrl || "").trim(),
      publicCoverUrl: String(item.publicCoverUrl || "").trim(),
    };

    if (!prepared.podPackageId) missing.push(`${item.slug}.podPackageId`);
    if (!prepared.pageCount) missing.push(`${item.slug}.actualInteriorPages`);
    if (!isPublicPdfUrl(prepared.publicInteriorUrl)) missing.push(`${item.slug}.publicInteriorUrl`);
    if (!isPublicPdfUrl(prepared.publicCoverUrl)) missing.push(`${item.slug}.publicCoverUrl`);

    return prepared;
  });

  if (!products.length) {
    missing.push(`${product.slug}.componentProductSlugs`);
  }

  return {
    ready: missing.length === 0,
    missing,
    lineItems,
  };
}

export function normalizeLuluShippingAddress(input: unknown): LuluShippingAddress {
  const value = isRecord(input) ? input : {};
  return {
    name: stringFrom(value.name),
    street1: stringFrom(value.street1 || value.line1),
    street2: stringFrom(value.street2 || value.line2) || undefined,
    city: stringFrom(value.city),
    state_code: stringFrom(value.state_code || value.state || value.province),
    postcode: stringFrom(value.postcode || value.postal_code || value.zip),
    country_code: stringFrom(value.country_code || value.country || "US").toUpperCase(),
    phone_number: stringFrom(value.phone_number || value.phone),
    email: stringFrom(value.email) || undefined,
  };
}

export function missingLuluShippingAddressFields(address: LuluShippingAddress) {
  const missing: string[] = [];
  if (!address.name) missing.push("shipping_address.name");
  if (!address.street1) missing.push("shipping_address.street1");
  if (!address.city) missing.push("shipping_address.city");
  if (!address.postcode) missing.push("shipping_address.postcode");
  if (!address.country_code) missing.push("shipping_address.country_code");
  if (!address.phone_number) missing.push("shipping_address.phone_number");
  if (address.country_code === "US" && !address.state_code) missing.push("shipping_address.state_code");
  return missing;
}

export function buildLuluCostPayload(
  product: PrintProduct,
  shippingAddress: LuluShippingAddress,
  shippingOption: LuluShippingLevel = "MAIL",
): LuluCostCalculationPayload {
  const readiness = getLuluReadiness(product);
  if (!readiness.ready) {
    throw new LuluReadinessError("This print product is not ready for Lulu yet.", readiness);
  }

  return {
    currency: "USD",
    line_items: readiness.lineItems.map(item => ({
      page_count: item.pageCount,
      pod_package_id: item.podPackageId,
      quantity: item.quantity,
    })),
    shipping_address: shippingAddress,
    shipping_option: shippingOption,
  };
}

export function buildLuluPrintJobPayload({
  product,
  shippingAddress,
  externalId,
  contactEmail,
  shippingLevel = "MAIL",
}: {
  product: PrintProduct;
  shippingAddress: LuluShippingAddress;
  externalId: string;
  contactEmail: string;
  shippingLevel?: LuluShippingLevel;
}): LuluPrintJobPayload {
  const readiness = getLuluReadiness(product);
  if (!readiness.ready) {
    throw new LuluReadinessError("This print product is not ready for Lulu yet.", readiness);
  }

  return {
    contact_email: contactEmail,
    external_id: externalId,
    line_items: readiness.lineItems.map((item, index) => ({
      external_id: `${externalId}-${item.productSlug}-${index + 1}`,
      printable_normalization: {
        cover: { source_url: item.publicCoverUrl },
        interior: { source_url: item.publicInteriorUrl },
        pod_package_id: item.podPackageId,
      },
      quantity: item.quantity,
      title: item.title,
    })),
    shipping_address: shippingAddress,
    shipping_level: shippingLevel,
  };
}

export async function getLuluAccessToken() {
  const clientKey = process.env.LULU_CLIENT_KEY || "";
  const clientSecret = process.env.LULU_CLIENT_SECRET || "";
  if (!clientKey || !clientSecret) {
    throw new Error("Missing Lulu API credentials.");
  }

  const credentials = Buffer.from(`${clientKey}:${clientSecret}`).toString("base64");
  const response = await fetch(buildLuluUrl(LULU_TOKEN_PATH), {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const data = await parseLuluResponse<{ access_token?: string }>(response);

  if (!data.access_token) {
    throw new Error("Lulu did not return an access token.");
  }

  return data.access_token;
}

export async function luluRequest<T>(path: string, init: RequestInit = {}) {
  const accessToken = await getLuluAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(buildLuluUrl(path), {
    ...init,
    headers,
  });

  return parseLuluResponse<T>(response);
}

export function calculateLuluPrintJobCost(payload: LuluCostCalculationPayload) {
  return luluRequest<unknown>("/print-job-cost-calculations/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createLuluPrintJob(payload: LuluPrintJobPayload) {
  return luluRequest<unknown>("/print-jobs/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getLuluJobId(response: unknown) {
  if (!isRecord(response)) return "";
  return stringFrom(response.id || response.print_job_id || response.uuid);
}

function getLuluShipmentProducts(product: PrintProduct) {
  if (product.kind !== "bundle") return [product];
  return getPrintProductComponents(product).filter(component => component.kind !== "bundle");
}

function getLuluApiBaseUrl() {
  return (process.env.LULU_API_BASE_URL || DEFAULT_LULU_API_BASE_URL).replace(/\/+$/, "");
}

function buildLuluUrl(path: string) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${getLuluApiBaseUrl()}${cleanPath}`;
}

async function parseLuluResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data = {} as T;

  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      if (!response.ok) {
        throw new Error(`Lulu request failed with status ${response.status}: ${text.slice(0, 240)}`);
      }

      throw new Error("Lulu returned a response that was not JSON.");
    }
  }

  if (!response.ok) {
    const message = isRecord(data) && typeof data.message === "string"
      ? data.message
      : `Lulu request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return data;
}

function isPublicPdfUrl(value: string) {
  if (!/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.hostname !== "localhost" && url.hostname !== "127.0.0.1";
  } catch {
    return false;
  }
}

function stringFrom(value: unknown) {
  return String(value || "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
