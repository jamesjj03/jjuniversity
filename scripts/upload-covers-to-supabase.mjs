import { createClient } from "@supabase/supabase-js";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
loadLocalEnv(".env.local");
loadLocalEnv(".env");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const bucket = getArgValue("--bucket") || process.env.NEXT_PUBLIC_SUPABASE_COVER_BUCKET || "covers";
const coversDir = join(root, "public", "covers-webp");

if (!existsSync(coversDir)) {
  console.error(`Missing covers directory: ${coversDir}`);
  process.exit(1);
}

const files = readdirSync(coversDir)
  .filter(file => file.toLowerCase().endsWith(".webp"))
  .sort((a, b) => a.localeCompare(b));

if (!files.length) {
  console.log("No WebP covers found.");
  process.exit(0);
}

const totalBytes = files.reduce((sum, file) => sum + statSync(join(coversDir, file)).size, 0);

if (dryRun) {
  console.log(`Dry run: ${files.length} cover(s), ${formatBytes(totalBytes)}, bucket "${bucket}".`);
  console.log(`First: ${files[0]}`);
  console.log(`Last: ${files[files.length - 1]}`);
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

let uploaded = 0;
for (const file of files) {
  const body = readFileSync(join(coversDir, file));
  const { error } = await supabase.storage.from(bucket).upload(file, body, {
    cacheControl: "31536000",
    contentType: "image/webp",
    upsert: true,
  });

  if (error) throw new Error(`Could not upload ${file}: ${error.message}`);
  uploaded += 1;
  if (uploaded % 50 === 0 || uploaded === files.length) {
    console.log(`Uploaded ${uploaded}/${files.length}`);
  }
}

console.log(`Uploaded ${files.length} cover(s) to public bucket "${bucket}" (${formatBytes(totalBytes)}).`);

async function ensurePublicBucket(bucketName) {
  const { data, error } = await supabase.storage.getBucket(bucketName);
  if (data && !error) {
    if (!data.public) {
      const { error: updateError } = await supabase.storage.updateBucket(bucketName, { public: true });
      if (updateError) throw new Error(`Could not make bucket "${bucketName}" public: ${updateError.message}`);
    }
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(bucketName, {
    public: true,
    allowedMimeTypes: ["image/webp"],
    fileSizeLimit: "2MB",
  });

  if (createError) throw new Error(`Could not create storage bucket "${bucketName}": ${createError.message}`);
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
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
