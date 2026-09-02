import { revalidatePath } from "next/cache";
import {
  prepareBookContentForSave,
  saveLiveBookContentToSupabase,
  type BookContent,
} from "@/lib/bookContent";
import {
  adminErrorResponse,
  assertAdminVersion,
  expectedAdminVersion,
  versionedJson,
  writeGithubJson,
  writeLocalJson,
} from "@/lib/adminVersionedJson";
import { readAdminBookContent, versionAfterContentWrite } from "@/lib/adminBookContent";
import { getBookById, isPublishedReadableBook } from "@/lib/publishing";

type SaveBody = {
  sectionId?: string;
  html?: string;
  title?: string;
  kind?: string;
  book?: Partial<BookContent>;
  message?: string;
};

function revalidateWorkshopManuscript(bookId: string) {
  try {
    revalidatePath("/admin");
    revalidatePath("/admin/books");
    revalidatePath(`/admin/books/${encodeURIComponent(bookId)}`);
    revalidatePath(`/admin/books/${encodeURIComponent(bookId)}/publication`);
  } catch {
    // An editor refresh should never make a successful private save look failed.
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { book, fileName, publicPath, source, version } = await readAdminBookContent(id);

    return versionedJson({
      ...book,
      contentFile: fileName,
      contentPath: publicPath,
      contentSource: source,
    }, version);
  } catch (error) {
    return adminErrorResponse(error, "Could not load book content.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const expectedVersion = expectedAdminVersion(request);
    const body = await request.json().catch(() => ({})) as SaveBody;
    const current = await readAdminBookContent(id);
    assertAdminVersion(expectedVersion, current.version);
    const { book, fileName, publicPath, absolutePath } = current;
    const bodySections = Array.isArray(body.book?.sections) ? body.book.sections : null;
    const nextBook = prepareBookContentForSave({
      ...book,
      ...body.book,
      id: book.id,
      sections: (bodySections || book.sections).map(section => {
        if (section.id !== body.sectionId) return section;
        return {
          ...section,
          html: typeof body.html === "string" ? body.html : section.html,
          title: typeof body.title === "string" ? body.title : section.title,
          kind: typeof body.kind === "string" ? body.kind : section.kind,
        };
      }),
    });
    const content = `${JSON.stringify(nextBook, null, 2)}\n`;
    const message = body.message || `Update ${nextBook.title || nextBook.id} content (${new Date().toISOString().slice(0, 10)})`;
    if (current.source === "supabase" || current.supabaseAvailable) {
      const supabaseSave = await saveLiveBookContentToSupabase({
        book: nextBook,
        fileName,
        publicPath,
        message,
        expectedVersion: current.source === "supabase" ? current.writeVersion : "supabase:0",
      });
      if (!supabaseSave.saved) {
        throw new Error(supabaseSave.error || "Live manuscript storage became unavailable while saving. Reload before trying again.");
      }
      const nextVersion = `supabase:${Math.max(1, Number(supabaseSave.versionNumber || 1))}`;
      revalidateWorkshopManuscript(nextBook.id);
      return versionedJson({
        saved: true,
        target: "supabase",
        versionNumber: supabaseSave.versionNumber,
        note: `Saved privately to Supabase${supabaseSave.versionNumber ? ` as version ${supabaseSave.versionNumber}` : ""}. It is not public until a reviewed edition is published.`,
        contentFile: fileName,
        contentPath: publicPath,
        ...nextBook,
      }, nextVersion);
    }

    if (current.source === "github") {
      const publishedBook = getBookById(nextBook.id);
      if (!publishedBook || !isPublishedReadableBook(publishedBook)) {
        throw new Error("Private manuscripts are never written to the public GitHub repository. Save through Supabase or locally instead.");
      }
      const github = await writeGithubJson(publicPath, content, message, current.writeVersion);
      if (!github) throw new Error("GitHub manuscript saving is not configured.");
      revalidateWorkshopManuscript(nextBook.id);
      return versionedJson({
        saved: true,
        target: "github",
        commit: github.data?.commit?.html_url,
        contentFile: fileName,
        contentPath: publicPath,
        ...nextBook,
      }, versionAfterContentWrite(current, github.version));
    }

    const local = await writeLocalJson(absolutePath, content, current.writeVersion);
    revalidateWorkshopManuscript(nextBook.id);
    return versionedJson({
      saved: true,
      target: "local",
      note: "Saved locally as a private editorial change. It is not public until a reviewed edition is published.",
      contentFile: fileName,
      contentPath: publicPath,
      ...nextBook,
    }, versionAfterContentWrite(current, local.version));
  } catch (error) {
    return adminErrorResponse(error, "Could not save book content.");
  }
}
