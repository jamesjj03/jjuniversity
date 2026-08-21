import { writeFile } from "fs/promises";
import path from "path";
import { cleanPathsFile } from "@/lib/paths";
import {
  adminErrorResponse,
  expectedAdminVersion,
  readGithubJson,
  readLocalJson,
  versionedJson,
  writeGithubJson,
  writeLocalJson,
} from "@/lib/adminVersionedJson";

function assertRawPaths(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Paths source is not an object.");
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.series) || !Array.isArray(data.paths)) {
    throw new Error("Paths source must include series and paths arrays.");
  }
  for (const key of ["tagPaths", "recommendedReading"]) {
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error(`${key} must be an array.`);
  }
  const groups = [data.series, data.paths, data.tagPaths || [], data.recommendedReading || []].flat() as unknown[];
  if (!groups.length) throw new Error("Refusing to load or save an empty paths document.");
  const groupIds = new Set<string>();
  groups.forEach((group, index) => {
    if (!group || typeof group !== "object" || Array.isArray(group)) throw new Error(`Path group ${index + 1} is invalid.`);
    const record = group as Record<string, unknown>;
    const groupId = String(record.id || "").trim().toLowerCase();
    if (!groupId || !String(record.title || "").trim() || !Array.isArray(record.books) || !record.books.length) {
      throw new Error(`Path group ${index + 1} is missing id, title, or books.`);
    }
    if (groupIds.has(groupId)) throw new Error(`Paths source contains duplicate group id: ${groupId}.`);
    groupIds.add(groupId);
    const bookIds = new Set<string>();
    record.books.forEach((book, bookIndex) => {
      const bookId = book && typeof book === "object" ? String((book as Record<string, unknown>).id || "").trim().toLowerCase() : "";
      if (!bookId) throw new Error(`Path ${groupId} has an invalid book at position ${bookIndex + 1}.`);
      if (bookIds.has(bookId)) throw new Error(`Path ${groupId} contains duplicate book id: ${bookId}.`);
      bookIds.add(bookId);
    });
  });
  return value;
}

export async function GET() {
  try {
    const github = await readGithubJson("public/paths.json");
    if (github) return versionedJson(cleanPathsFile(assertRawPaths(github.value)), github.version);
    const pathsPath = path.join(process.cwd(), "public", "paths.json");
    const local = await readLocalJson(pathsPath);
    return versionedJson(cleanPathsFile(assertRawPaths(local.value)), local.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not load paths.json.");
  }
}

export async function POST(request: Request) {
  try {
    const expectedVersion = expectedAdminVersion(request);
    const body = await request.json().catch(() => ({}));
    const paths = cleanPathsFile(assertRawPaths(body.paths || body));
    const content = `${JSON.stringify(paths, null, 2)}\n`;
    const pathsPath = path.join(process.cwd(), "public", "paths.json");
    const message = body.message || `Update JJU reading paths (${new Date().toISOString().slice(0, 10)})`;

    const github = await writeGithubJson("public/paths.json", content, message, expectedVersion);
    if (github) {
      try {
        await writeFile(pathsPath, content, "utf8");
      } catch {
        // Deployment files may be read-only; GitHub is the canonical successful write.
      }
      return versionedJson({ saved: true, target: "github", paths }, github.version);
    }

    const local = await writeLocalJson(pathsPath, content, expectedVersion);
    return versionedJson({
      saved: true,
      target: "local",
      paths,
      note: "Saved locally. Add GITHUB_TOKEN and GITHUB_REPO to save live through GitHub.",
    }, local.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not save paths.json.");
  }
}
