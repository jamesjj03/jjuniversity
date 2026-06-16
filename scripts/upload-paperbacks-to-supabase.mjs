import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
loadLocalEnv(".env.local");
loadLocalEnv(".env");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const bucket = getArgValue("--bucket") || process.env.SUPABASE_PRINT_BUCKET || "paperbacks";
const onlyProducts = (getArgValue("--products") || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);
const productsPath = join(root, "public", "print-products.json");
const products = JSON.parse(readFileSync(productsPath, "utf8"));
const selectedProducts = products.filter(product => {
  if (product.kind !== "collection") return false;
  if (!onlyProducts.length) return true;
  return onlyProducts.includes(product.slug);
});

if (!selectedProducts.length) {
  console.log("No collection print products matched.");
  process.exit(0);
}

const uploadPlan = selectedProducts.map(product => {
  const basePath = join(root, "generated", "paperbacks", product.slug);
  return {
    product,
    files: [
      {
        key: "publicInteriorUrl",
        localPath: join(basePath, "interior.pdf"),
        storagePath: `${product.slug}/interior.pdf`,
      },
      {
        key: "publicCoverUrl",
        localPath: join(basePath, "cover-wrap.pdf"),
        storagePath: `${product.slug}/cover-wrap.pdf`,
      },
    ],
  };
});

const missingFiles = uploadPlan.flatMap(item => item.files
  .filter(file => !existsSync(file.localPath))
  .map(file => `${item.product.slug}: ${file.localPath}`));

if (missingFiles.length) {
  console.error("Missing generated paperback PDFs:");
  missingFiles.forEach(file => console.error(`- ${file}`));
  process.exit(1);
}

if (dryRun) {
  console.log(`Dry run: ${uploadPlan.length} product(s), bucket "${bucket}".`);
  uploadPlan.forEach(item => {
    console.log(`- ${item.product.slug}`);
    item.files.forEach(file => {
      console.log(`  ${file.storagePath} (${formatBytes(statSync(file.localPath).size)})`);
    });
  });
  process.exit(0);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

await ensurePublicBucket(bucket);

for (const item of uploadPlan) {
  for (const file of item.files) {
    const body = readFileSync(file.localPath);
    const { error } = await supabase.storage.from(bucket).upload(file.storagePath, body, {
      contentType: "application/pdf",
      upsert: true,
    });

    if (error) {
      throw new Error(`Could not upload ${file.storagePath}: ${error.message}`);
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(file.storagePath);
    item.product[file.key] = data.publicUrl;
    console.log(`Uploaded ${file.storagePath}`);
  }
}

mkdirSync(dirname(productsPath), { recursive: true });
writeFileSync(productsPath, `${JSON.stringify(products, null, 2)}\n`);
console.log(`Updated ${productsPath}`);

async function ensurePublicBucket(bucketName) {
  const { data, error } = await supabase.storage.getBucket(bucketName);
  if (data && !error) return;

  const { error: createError } = await supabase.storage.createBucket(bucketName, {
    public: true,
    allowedMimeTypes: ["application/pdf"],
  });

  if (createError) {
    throw new Error(`Could not create storage bucket "${bucketName}": ${createError.message}`);
  }
}

function getArgValue(name) {
  const prefix = `${name}=`;
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length) || "";
}

function loadLocalEnv(fileName) {
  const filePath = join(root, fileName);
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
