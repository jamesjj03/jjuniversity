import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type PrintProofPreviewAsset = {
  id: string;
  fileName: string;
  label: string;
  note: string;
  width: number;
  height: number;
  sourceLabel: string;
  sourceSha256: string;
  sourcePage: number;
};

export type PrintProofPreviewGroup = {
  id: "covers" | "volume-1" | "volume-2";
  title: string;
  summary: string;
  assets: PrintProofPreviewAsset[];
};

const COVER_DIRECTIONS_SOURCE = {
  label: "101: How We Figured It Out cover-directions proof v2",
  sha256: "87fd73afb387ca0afa09dda5b37b64d08a68fe6a59f70a77556d7639767da32e",
};

const VOLUME_ONE_INTERIOR_SOURCE = {
  label: "Volume I - The Natural World interior proof (354 pages)",
  sha256: "a961432bcdd5d19c16e83f0c6ea25a1b8e6c44458a647ba26ff419b4016151c5",
};

const VOLUME_TWO_INTERIOR_SOURCE = {
  label: "Volume II - The Human World interior proof (314 pages)",
  sha256: "9d092f1899722b944b7fd5e7c68a4175646082c14c0d12f01b07bcd1c4ffa482",
};

const VOLUME_ONE_LEGAL_SOURCE = {
  label: "Volume I copyright/disclaimer one-page proof",
  sha256: "4d8c3905859df6d6d5a7df375c9b6d51400837c966e74be4404f9f991ce6ecaa",
};

const VOLUME_TWO_LEGAL_SOURCE = {
  label: "Volume II copyright/disclaimer one-page proof",
  sha256: "3a8790e247658e6a8cb8baae522dcc3e8770ab832bce3a727be96bb5909e72dd",
};

function preview(
  id: string,
  fileName: string,
  label: string,
  note: string,
  source: { label: string; sha256: string },
  sourcePage: number,
  width = 720,
  height = 1080,
): PrintProofPreviewAsset {
  return {
    id,
    fileName,
    label,
    note,
    width,
    height,
    sourceLabel: source.label,
    sourceSha256: source.sha256,
    sourcePage,
  };
}

export const PRINT_PROOF_PREVIEW_GROUPS: PrintProofPreviewGroup[] = [
  {
    id: "covers",
    title: "Cover directions and real wraps",
    summary: "Three corrected design boards plus four older package-size System wraps retained only for construction reference. No direction is approved.",
    assets: [
      preview("cover-archive", "cover-board-archive.png", "Direction 1 - Archive", "Illustrated reference plates under exact typography, with 101 as the line and each volume carrying its own title.", COVER_DIRECTIONS_SOURCE, 1, 1920, 1080),
      preview("cover-library", "cover-board-library.png", "Direction 2 - Library", "A clothbound encyclopedia system designed to keep future Collection volumes coherent on a shelf.", COVER_DIRECTIONS_SOURCE, 2, 1920, 1080),
      preview("cover-field-index", "cover-board-field-index.png", "Direction 3 - Field Index", "A cleaner evolution of Index with the corrected 101: How We Figured It Out hierarchy.", COVER_DIRECTIONS_SOURCE, 3, 1920, 1080),
      preview(
        "v1-paperback-wrap",
        "v1-paperback-wrap.png",
        "Volume I paperback wrap",
        "System direction on the 13.107 x 9.25 inch paperback template.",
        { label: "Volume I paperback System cover proof", sha256: "69ee5346c765976da4f1878dc3f17e42be0c9ce5ab398cd500e37a0f70cdede6" },
        1,
        1573,
        1110,
      ),
      preview(
        "v1-casewrap-wrap",
        "v1-casewrap-wrap.png",
        "Volume I casewrap",
        "System direction on the 14.813 x 10.75 inch casewrap template.",
        { label: "Volume I casewrap System cover proof", sha256: "f6a28bcf56610cb1e66c17eb00eaf01756b17c1e16ac531c40fce04a2879272d" },
        1,
        1778,
        1290,
      ),
      preview(
        "v2-paperback-wrap",
        "v2-paperback-wrap.png",
        "Volume II paperback wrap",
        "System direction on the 13.017 x 9.25 inch paperback template.",
        { label: "Volume II paperback System cover proof", sha256: "7f4b51aa325ac7d2b514f097a2752e8c3029ff925abd536cf8a291e3e3a88a97" },
        1,
        1563,
        1110,
      ),
      preview(
        "v2-casewrap-wrap",
        "v2-casewrap-wrap.png",
        "Volume II casewrap",
        "System direction on the 14.75 x 10.75 inch casewrap template.",
        { label: "Volume II casewrap System cover proof", sha256: "c20c186fbef37171ea83ca3809f8c72636c34301da648bdb0a866fe492c9a9c7" },
        1,
        1770,
        1290,
      ),
    ],
  },
  {
    id: "volume-1",
    title: "Volume I - The Natural World",
    summary: "Title, legal page, contents, pacing, folios, intentional blanks, flagged sparse endings, transitions, and the close.",
    assets: [
      preview("v1-p001", "v1-p001-title.png", "Page 1 - title", "The product-level title leaf.", VOLUME_ONE_INTERIOR_SOURCE, 1),
      preview("v1-legal", "v1-p002-copyright-disclaimer.png", "Copyright and disclaimer", "The current standalone one-page legal direction; it is not a legal clearance or publication approval.", VOLUME_ONE_LEGAL_SOURCE, 1),
      preview("v1-p003", "v1-p003-contents.png", "Page 3 - contents", "Eight books and their recorded recto starts.", VOLUME_ONE_INTERIOR_SOURCE, 3),
      preview("v1-p004", "v1-p004-blank.png", "Page 4 - intentional blank", "A blank verso before the first book divider.", VOLUME_ONE_INTERIOR_SOURCE, 4),
      preview("v1-p005", "v1-p005-divider.png", "Page 5 - Math divider", "The first book divider and section count.", VOLUME_ONE_INTERIOR_SOURCE, 5),
      preview("v1-p006", "v1-p006-opening.png", "Page 6 - opening text", "The first representative manuscript page and folio.", VOLUME_ONE_INTERIOR_SOURCE, 6),
      preview("v1-p043", "v1-p043-folio-check.png", "Page 43 - end before blank", "Checks the closing-page folio and pacing before an intentional blank.", VOLUME_ONE_INTERIOR_SOURCE, 43),
      preview("v1-p044", "v1-p044-folio-check.png", "Page 44 - intentional blank", "The verso that protects the next recto divider.", VOLUME_ONE_INTERIOR_SOURCE, 44),
      preview("v1-p045", "v1-p045-folio-check.png", "Page 45 - Calculus divider", "Checks the recto transition into book two.", VOLUME_ONE_INTERIOR_SOURCE, 45),
      preview("v1-p143", "v1-p143-sparse.png", "Page 143 - short ending", "One of four deliberate sparse rhetorical endings flagged by QA.", VOLUME_ONE_INTERIOR_SOURCE, 143),
      preview("v1-p156", "v1-p156-sparse.png", "Page 156 - short ending", "A second deliberate sparse rhetorical ending.", VOLUME_ONE_INTERIOR_SOURCE, 156),
      preview("v1-p197", "v1-p197-sparse.png", "Page 197 - short ending", "A third deliberate sparse rhetorical ending.", VOLUME_ONE_INTERIOR_SOURCE, 197),
      preview("v1-p221", "v1-p221-transition.png", "Page 221 - Chemistry divider", "A later-book recto transition.", VOLUME_ONE_INTERIOR_SOURCE, 221),
      preview("v1-p249", "v1-p249-sparse.png", "Page 249 - short ending", "The fourth deliberate sparse rhetorical ending.", VOLUME_ONE_INTERIOR_SOURCE, 249),
      preview("v1-p345", "v1-p345-fixed.png", "Page 345 - repaired paragraph", "The paragraph that was repaginated after an earlier stranded word.", VOLUME_ONE_INTERIOR_SOURCE, 345),
      preview("v1-p353", "v1-p353-end.png", "Page 353 - final narrative page", "The closing page before the product-level end matter.", VOLUME_ONE_INTERIOR_SOURCE, 353),
    ],
  },
  {
    id: "volume-2",
    title: "Volume II - The Human World",
    summary: "Title, denser legal page, contents, pacing, folios, intentional blanks, a representative spread, transition, and the close.",
    assets: [
      preview("v2-p001", "v2-p001-title.png", "Page 1 - title", "The product-level title leaf.", VOLUME_TWO_INTERIOR_SOURCE, 1),
      preview("v2-legal", "v2-p002-copyright-disclaimer.png", "Copyright and disclaimer", "The denser standalone one-page legal direction; it is not a legal clearance or publication approval.", VOLUME_TWO_LEGAL_SOURCE, 1),
      preview("v2-p003", "v2-p003-contents.png", "Page 3 - contents", "Eight books and their recorded recto starts.", VOLUME_TWO_INTERIOR_SOURCE, 3),
      preview("v2-p004", "v2-p004-blank.png", "Page 4 - intentional blank", "A blank verso before the first book divider.", VOLUME_TWO_INTERIOR_SOURCE, 4),
      preview("v2-p005", "v2-p005-divider.png", "Page 5 - Anatomy divider", "The first book divider and section count.", VOLUME_TWO_INTERIOR_SOURCE, 5),
      preview("v2-p006", "v2-p006-opening.png", "Page 6 - opening text", "The first representative manuscript page and folio.", VOLUME_TWO_INTERIOR_SOURCE, 6),
      preview("v2-p049", "v2-p049-folio-check.png", "Page 49 - end before blank", "Checks the closing-page folio and pacing before an intentional blank.", VOLUME_TWO_INTERIOR_SOURCE, 49),
      preview("v2-p050", "v2-p050-folio-check.png", "Page 50 - intentional blank", "The verso that protects the next recto divider.", VOLUME_TWO_INTERIOR_SOURCE, 50),
      preview("v2-p051", "v2-p051-folio-check.png", "Page 51 - Psychology divider", "Checks the recto transition into book two.", VOLUME_TWO_INTERIOR_SOURCE, 51),
      preview("v2-p094", "v2-p094-095-philosophy-094.png", "Page 94 - Philosophy opening", "The left page of a representative two-page opening.", VOLUME_TWO_INTERIOR_SOURCE, 94),
      preview("v2-p095", "v2-p094-095-philosophy-095.png", "Page 95 - Philosophy opening", "The right page of the representative opening spread.", VOLUME_TWO_INTERIOR_SOURCE, 95),
      preview("v2-p277", "v2-p277-transition.png", "Page 277 - Economics divider", "The final book's recto transition.", VOLUME_TWO_INTERIOR_SOURCE, 277),
      preview("v2-p313", "v2-p313-end.png", "Page 313 - final narrative page", "The closing page before the product-level end matter.", VOLUME_TWO_INTERIOR_SOURCE, 313),
    ],
  },
];

const assetById = new Map(
  PRINT_PROOF_PREVIEW_GROUPS.flatMap(group => group.assets.map(asset => [asset.id, asset] as const)),
);

const previewRoot = resolve(process.cwd(), "private", "print-proof-previews");

export function getPrintProofPreviewAsset(id: string) {
  return assetById.get(id) || null;
}

export function getPrintProofPreviewHref(id: string) {
  return `/api/admin/print-proof/${encodeURIComponent(id)}`;
}

export async function readPrintProofPreview(asset: PrintProofPreviewAsset) {
  const bytes = await readFile(resolve(previewRoot, asset.fileName));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, sha256 };
}
