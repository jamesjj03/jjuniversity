import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const apiBase = "https://api.sandbox.lulu.com";
const manifestPath = resolve(root, "output", "pdf", "JJ-University-101-proof-manifest.json");
const resultPath = resolve(root, "output", "pdf", "JJ-University-101-lulu-sandbox-validation.json");
const bucket = process.env.SUPABASE_PRINT_BUCKET || "paperbacks";
const terminalStatuses = new Set(["NORMALIZED", "VALIDATED", "ERROR"]);

loadLocalEnv(".env.local");
loadLocalEnv(".env");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const clientKey = process.env.LULU_CLIENT_KEY || "";
const clientSecret = process.env.LULU_CLIENT_SECRET || "";
if (!supabaseUrl || !serviceRoleKey) fail("Missing Supabase proof-upload credentials.");
if (!clientKey || !clientSecret) fail("Missing Lulu sandbox credentials.");
if (!existsSync(manifestPath)) fail(`Missing proof manifest: ${manifestPath}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const proofDigest = createHash("sha256")
  .update(manifest.outputs.map(item => `${item.path}:${item.sha256}`).join("\n"))
  .digest("hex")
  .slice(0, 16);
const objectPrefix = `proofs/2026-08-19/jju-101-${proofDigest}`;
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const assets = [];
for (const volume of manifest.volumes) {
  assets.push({
    productSlug: volume.productSlug,
    kind: "interior",
    binding: null,
    pageCount: volume.pageCount,
    packageId: null,
    localPath: resolve(root, volume.interior.path),
    sha256: volume.interior.sha256,
  });
  for (const cover of volume.covers) {
    assets.push({
      productSlug: volume.productSlug,
      kind: "cover",
      binding: cover.binding,
      pageCount: volume.pageCount,
      packageId: manifest.packageCandidates[cover.binding],
      localPath: resolve(root, cover.path),
      sha256: cover.sha256,
    });
  }
}

for (const asset of assets) {
  if (!existsSync(asset.localPath)) fail(`Missing proof asset: ${asset.localPath}`);
  const extensionName = asset.kind === "interior" ? "interior.pdf" : `${asset.binding}-cover.pdf`;
  asset.objectPath = `${objectPrefix}/${asset.productSlug}/${extensionName}`;
  const { error } = await supabase.storage.from(bucket).upload(asset.objectPath, readFileSync(asset.localPath), {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) fail(`Proof upload failed for ${asset.objectPath}: ${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(asset.objectPath);
  asset.publicUrl = data.publicUrl;
  console.log(`Uploaded proof asset: ${asset.objectPath}`);
}

const token = await getToken();
const validationRequests = [];
for (const volume of manifest.volumes) {
  const interior = assets.find(item => item.productSlug === volume.productSlug && item.kind === "interior");
  for (const binding of ["paperback", "casewrap"]) {
    const packageId = manifest.packageCandidates[binding];
    validationRequests.push({
      productSlug: volume.productSlug,
      kind: "interior",
      binding,
      packageId,
      sourceSha256: interior.sha256,
      sourceObjectPath: interior.objectPath,
      endpoint: "/validate-interior/",
      payload: { source_url: interior.publicUrl, pod_package_id: packageId },
    });
    const cover = assets.find(item => item.productSlug === volume.productSlug && item.kind === "cover" && item.binding === binding);
    validationRequests.push({
      productSlug: volume.productSlug,
      kind: "cover",
      binding,
      packageId,
      sourceSha256: cover.sha256,
      sourceObjectPath: cover.objectPath,
      endpoint: "/validate-cover/",
      payload: { source_url: cover.publicUrl, pod_package_id: packageId, interior_page_count: volume.pageCount },
    });
  }
}

const validations = await Promise.all(validationRequests.map(async request => {
  const created = await luluRequest(request.endpoint, { method: "POST", body: JSON.stringify(request.payload) }, token);
  if (!created?.id) fail(`Lulu did not return a validation id for ${request.productSlug}/${request.binding}/${request.kind}.`);
  console.log(`Started ${request.kind} validation ${created.id}: ${request.productSlug}/${request.binding}`);
  const result = await pollValidation(request.endpoint, created.id, token);
  return {
    productSlug: request.productSlug,
    binding: request.binding,
    kind: request.kind,
    packageId: request.packageId,
    sourceSha256: request.sourceSha256,
    sourceObjectPath: request.sourceObjectPath,
    validationId: created.id,
    status: result.status,
    pageCount: result.page_count ?? null,
    validPodPackageIds: result.valid_pod_package_ids ?? null,
    errors: result.errors ?? null,
  };
}));

const quoteAddress = {
  name: "Library of Congress (test)",
  street1: "101 Independence Ave SE",
  city: "Washington",
  state_code: "DC",
  postcode: "20540",
  country_code: "US",
  phone_number: "202-707-5000",
};
const quotes = [];
for (const volume of manifest.volumes) {
  for (const binding of ["paperback", "casewrap"]) {
    const packageId = manifest.packageCandidates[binding];
    const payload = {
      currency: "USD",
      line_items: [{ page_count: volume.pageCount, pod_package_id: packageId, quantity: 1 }],
      shipping_address: quoteAddress,
      shipping_option: "MAIL",
    };
    const response = await luluRequest("/print-job-cost-calculations/", { method: "POST", body: JSON.stringify(payload) }, token);
    quotes.push({ productSlug: volume.productSlug, binding, pageCount: volume.pageCount, packageId, response });
    console.log(`Calculated sandbox cost: ${volume.productSlug}/${binding}`);
  }
}

const result = {
  schemaVersion: 1,
  environment: "lulu-sandbox",
  createdAtUtc: new Date().toISOString(),
  paidPrintJobCreated: false,
  printJobEndpointCalled: false,
  proofDigest,
  proofStorage: { bucket, objectPrefix },
  quoteBasis: {
    quantity: 1,
    currency: "USD",
    shippingOption: "MAIL",
    destination: "Public Library of Congress address from Lulu's own API documentation; estimate only, not the user's delivery address.",
  },
  validations,
  quotes,
};
writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`Wrote ${resultPath}`);

async function pollValidation(endpoint, id, accessToken) {
  const detailPath = `${endpoint}${id}/`;
  const deadline = Date.now() + 6 * 60 * 1000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const result = await luluRequest(detailPath, {}, accessToken);
    const status = String(result?.status || "").toUpperCase();
    if (status !== lastStatus) {
      console.log(`Validation ${id}: ${status || "UNKNOWN"}`);
      lastStatus = status;
    }
    if (terminalStatuses.has(status)) return result;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 5000));
  }
  fail(`Timed out waiting for Lulu validation ${id} (${lastStatus || "UNKNOWN"}).`);
}

async function getToken() {
  const response = await fetch(`${apiBase}/auth/realms/glasstree/protocol/openid-connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientKey}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) fail(`Lulu sandbox auth failed with status ${response.status}.`);
  return data.access_token;
}

async function luluRequest(path, init, accessToken) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    fail(`Lulu sandbox returned non-JSON for ${path}: ${text.slice(0, 240)}`);
  }
  if (!response.ok) fail(`Lulu sandbox ${path} failed (${response.status}): ${JSON.stringify(data)}`);
  return data;
}

function loadLocalEnv(fileName) {
  const filePath = resolve(root, fileName);
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function fail(message) {
  throw new Error(message);
}
