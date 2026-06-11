import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

const ROOT = process.cwd();
const INPUT_DIR = path.join(ROOT, "public", "covers");
const OUTPUT_DIR = path.join(ROOT, "public", "covers-webp");

const VALID_EXTS = new Set([".jpg", ".jpeg", ".png"]);

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const files = await fs.readdir(INPUT_DIR);
  const images = files.filter((file) =>
    VALID_EXTS.has(path.extname(file).toLowerCase())
  );

  console.log(`Found ${images.length} images`);

  for (const file of images) {
    const inputPath = path.join(INPUT_DIR, file);

    const baseName = path.basename(file, path.extname(file));

    const outputPath = path.join(
      OUTPUT_DIR,
      `${baseName}.webp`
    );

    if (await exists(outputPath)) {
      console.log(`Skipping ${file}`);
      continue;
    }

    try {
      await sharp(inputPath)
        .resize({ width: 420, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(outputPath);

      console.log(`Converted ${file}`);
    } catch (err) {
      console.error(`Failed ${file}`);
      console.error(err.message);
    }
  }

  console.log("DONE");
}

main();