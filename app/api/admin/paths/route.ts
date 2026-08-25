import { writeFile } from "fs/promises";
import path from "path";
import { readAdminBookCatalog } from "@/lib/adminBookCatalog";
import {
  COLLECTIONS_MEMBERSHIP_EDITOR_SCOPE,
  rebaseOrganizerMembershipDraft,
} from "@/lib/collectionsOrganizer";
import { cleanPathsFile } from "@/lib/paths";
import type { PathsFile } from "@/lib/paths";
import {
  AdminVersionConflictError,
  adminErrorResponse,
  assertAdminVersion,
  expectedAdminVersion,
  readGithubJson,
  readLocalJson,
  versionedJson,
  writeGithubJson,
  writeLocalJson,
} from "@/lib/adminVersionedJson";

function assertRawPaths(value: unknown): PathsFile {
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
  return value as PathsFile;
}

async function assertCatalogBookIds(value: PathsFile) {
  const catalog = await readAdminBookCatalog();
  const catalogIds = new Set(catalog.books.map(book => String(book.id || "").trim().toLowerCase()).filter(Boolean));
  const data = value as Record<string, unknown>;
  const groups = [data.series, data.paths, data.tagPaths || [], data.recommendedReading || []].flat() as Array<Record<string, unknown>>;
  const missing = [...new Set(groups.flatMap(group => (group.books as Array<Record<string, unknown>>)
    .map(book => String(book.id || "").trim().toLowerCase())
    .filter(id => id && !catalogIds.has(id))))];
  if (missing.length) {
    throw new AdminVersionConflictError(`Collections reference ${missing.length} book id${missing.length === 1 ? "" : "s"} missing from the authoritative catalog: ${missing.slice(0, 8).join(", ")}. Reload before saving.`);
  }
  return value;
}

async function readAuthoritativePaths() {
  const github = await readGithubJson("public/paths.json");
  if (github) return { paths: assertRawPaths(github.value), version: github.version };
  const pathsPath = path.join(process.cwd(), "public", "paths.json");
  const local = await readLocalJson(pathsPath);
  return { paths: assertRawPaths(local.value), version: local.version };
}

export async function GET() {
  try {
    const authoritative = await readAuthoritativePaths();
    const checked = await assertCatalogBookIds(authoritative.paths);
    return versionedJson(cleanPathsFile(checked), authoritative.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not load paths.json.");
  }
}

export async function POST(request: Request) {
  try {
    const expectedVersion = expectedAdminVersion(request);
    const body = await request.json().catch(() => ({}));
    const submitted = assertRawPaths(body.paths || body);
    let scopedPaths = submitted;
    if (body.editorScope === COLLECTIONS_MEMBERSHIP_EDITOR_SCOPE) {
      const authoritative = await readAuthoritativePaths();
      assertAdminVersion(expectedVersion, authoritative.version);
      const rebased = rebaseOrganizerMembershipDraft(authoritative.paths, submitted);
      if (!rebased) {
        throw new Error("Collections membership save was rejected because its Collection structure did not match the authoritative file.");
      }
      scopedPaths = rebased;
    }
    const checked = await assertCatalogBookIds(scopedPaths);
    const paths = cleanPathsFile(checked);
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
