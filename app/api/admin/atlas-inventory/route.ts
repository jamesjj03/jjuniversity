import { readFile, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

const ALLOWED_STATUSES = new Set(["candidate", "review", "rejected"]);

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const domain = String(body.domain || "").trim().toLowerCase();
    const id = String(body.id || "").trim().toLowerCase();
    const status = String(body.status || "").trim().toLowerCase();

    if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(domain)) throw new Error("Invalid inventory domain.");
    if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(id)) throw new Error("Invalid inventory term id.");
    if (!ALLOWED_STATUSES.has(status)) throw new Error("Invalid inventory status.");

    const filePath = path.join(process.cwd(), "atlas", "inventories", domain, "terms.json");
    const inventory = JSON.parse(await readFile(filePath, "utf8"));
    const terms = Array.isArray(inventory.terms) ? inventory.terms : [];
    const index = terms.findIndex((term: { id?: string }) => term.id === id);
    if (index < 0) throw new Error(`Term ${id} was not found in ${domain}.`);

    terms[index] = {
      ...terms[index],
      status,
      promoted: status === "promoted" ? true : Boolean(terms[index].promoted),
    };

    inventory.generatedAt = new Date().toISOString();
    inventory.terms = terms;
    await writeFile(filePath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");

    return NextResponse.json({ saved: true, term: terms[index] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update inventory term." },
      { status: 500 },
    );
  }
}
