import { readFile, readdir } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { readBooksFromSupabase } from "@/lib/bookCatalog";

type BookRecord = {
  id?: string;
  title?: string;
  coverFile?: string;
};

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function compact(value: string) {
  return value.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]/g, "");
}

function escapeSvg(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleLines(title: string) {
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  words.forEach(word => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 16 && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });

  if (current) lines.push(current);
  return lines.slice(0, 5);
}

async function findCover(file: string) {
  const webpDir = path.join(process.cwd(), "public", "covers-webp");
  const coversDir = path.join(process.cwd(), "public", "covers");
  const requested = compact(file);

  const webpFiles = await readdir(webpDir).catch(() => []);
  const webp = webpFiles.find(item => compact(item) === requested && item.toLowerCase().endsWith(".webp"));
  if (webp) return path.join(webpDir, webp);

  const files = await readdir(coversDir);
  const exact = files.find(item => item.toLowerCase() === file.toLowerCase());
  if (exact) return path.join(coversDir, exact);

  const normalized = files.find(item => compact(item) === requested);
  if (normalized) return path.join(coversDir, normalized);

  return "";
}

async function findBook(file: string) {
  const wanted = compact(file);
  const supabaseBooks = await readBooksFromSupabase().catch(() => null);
  const supabaseBook = supabaseBooks?.find(book => compact(book.coverFile || `${book.id || ""}.jpg`) === wanted || compact(book.id || "") === wanted);
  if (supabaseBook) return supabaseBook;

  const booksPath = path.join(process.cwd(), "public", "books.json");
  const raw = JSON.parse(await readFile(booksPath, "utf8"));
  const books: BookRecord[] = Array.isArray(raw) ? raw : raw.books || [];
  return books.find(book => compact(book.coverFile || `${book.id || ""}.jpg`) === wanted || compact(book.id || "") === wanted);
}

function generatedCover(title: string, id: string) {
  const lines = titleLines(title || id || "JJ University");
  const titleText = lines.map((line, index) => (
    `<text x="50%" y="${238 + index * 52}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${lines.length > 3 ? 38 : 46}" font-weight="900" fill="#f7f0df">${escapeSvg(line)}</text>`
  )).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#241d11"/>
      <stop offset=".48" stop-color="#0f151b"/>
      <stop offset="1" stop-color="#111"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="26%" r="58%">
      <stop offset="0" stop-color="#d6b25e" stop-opacity=".55"/>
      <stop offset="1" stop-color="#d6b25e" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="800" height="1200" fill="url(#bg)"/>
  <rect width="800" height="1200" fill="url(#glow)"/>
  <rect x="54" y="54" width="692" height="1092" rx="18" fill="none" stroke="#d6b25e" stroke-opacity=".62" stroke-width="4"/>
  <text x="50%" y="126" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="900" letter-spacing="8" fill="#d6b25e">JJ UNIVERSITY</text>
  ${titleText}
  <text x="50%" y="1060" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="700" letter-spacing="7" fill="#d6b25e">JAMES JOHNSON</text>
</svg>`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const cleanFile = decodeURIComponent(file).replace(/[\\/]/g, "");

  try {
    const coverPath = await findCover(cleanFile);
    if (coverPath) {
      const ext = path.extname(coverPath).toLowerCase();
      return new NextResponse(await readFile(coverPath), {
        headers: {
          "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    const book = await findBook(cleanFile);
    return new NextResponse(generatedCover(book?.title || cleanFile.replace(/\.[^.]+$/, ""), book?.id || ""), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(generatedCover(cleanFile.replace(/\.[^.]+$/, ""), ""), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }
}
