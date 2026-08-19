import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PRIVATE_TABLES = [
  "profiles",
  "saved_books",
  "reading_progress",
  "completed_books",
  "reading_sessions",
  "reader_bookmarks",
  "reader_notes",
  "reader_quotes",
];
const SNAPSHOT_ORDER = {
  profiles: "id.asc",
  saved_books: "user_id.asc,book_id.asc",
  reading_progress: "user_id.asc,book_id.asc",
  completed_books: "user_id.asc,book_id.asc",
  reading_sessions: "id.asc",
  reader_bookmarks: "user_id.asc,key.asc",
  reader_notes: "user_id.asc,key.asc",
  reader_quotes: "user_id.asc,id.asc",
};

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "..");

function parseEnv(source) {
  const result = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

async function loadConfig() {
  const localEnv = parseEnv(await readFile(path.join(projectRoot, ".env.local"), "utf8"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || localEnv.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || localEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || localEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publishableKey || !serviceRoleKey) {
    throw new Error("Missing JJU Supabase URL, publishable key, or service-role key.");
  }
  const projectRef = new URL(url).hostname.split(".")[0];
  if (projectRef !== "nzlmnbppynjmutuukmbt") {
    throw new Error(`Refusing to inspect unexpected Supabase project ${projectRef}.`);
  }
  return { url, publishableKey, serviceRoleKey, projectRef };
}

async function apiRequest(config, pathname, {
  apiKey = config.serviceRoleKey,
  token = apiKey,
  method = "GET",
  body,
  prefer,
  head = false,
  range,
} = {}) {
  const headers = { apikey: apiKey, Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  if (range) {
    headers.Range = `${range.from}-${range.to}`;
    headers["Range-Unit"] = "items";
  }
  const response = await fetch(`${config.url}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = head ? "" : await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw; }
  }
  if (!response.ok) {
    const error = new Error(data?.message || data?.msg || data?.error_description || `Request failed (${response.status}).`);
    error.code = data?.code || String(response.status);
    error.status = response.status;
    throw error;
  }
  return { data, response };
}

async function selectRows(config, table, {
  token = config.serviceRoleKey,
  columns = "*",
  filters = {},
  head = false,
  count = false,
  range,
  order,
} = {}) {
  const params = new URLSearchParams({ select: columns });
  if (order) params.set("order", order);
  for (const [column, value] of Object.entries(filters)) params.set(column, `eq.${value}`);
  const { data, response } = await apiRequest(config, `/rest/v1/${encodeURIComponent(table)}?${params}`, {
    apiKey: token === config.serviceRoleKey ? config.serviceRoleKey : config.publishableKey,
    token,
    method: head ? "HEAD" : "GET",
    prefer: count ? "count=exact" : undefined,
    head,
    range,
  });
  const contentRange = response.headers.get("content-range") || "";
  const parsedCount = contentRange.includes("/") ? Number(contentRange.split("/").at(-1)) : null;
  return { data: data || [], count: Number.isFinite(parsedCount) ? parsedCount : null };
}

async function mutateRows(config, table, {
  token,
  method,
  body,
  filters = {},
}) {
  const params = new URLSearchParams({ select: "*" });
  for (const [column, value] of Object.entries(filters)) params.set(column, `eq.${value}`);
  const result = await apiRequest(config, `/rest/v1/${encodeURIComponent(table)}?${params}`, {
    apiKey: token === config.serviceRoleKey ? config.serviceRoleKey : config.publishableKey,
    token,
    method,
    body,
    prefer: "return=representation",
  });
  return result.data || [];
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function snapshotTable(config, table, outputDir) {
  let expectedCount;
  try {
    ({ count: expectedCount } = await selectRows(config, table, { head: true, count: true }));
  } catch (error) {
    return { table, available: false, error: `${error.code || ""} ${error.message}`.trim() };
  }
  if (!Number.isFinite(expectedCount)) throw new Error(`Could not prove the row count for ${table}; refusing a partial snapshot.`);

  const data = [];
  const pageSize = 1000;
  for (let offset = 0; offset < expectedCount; offset += pageSize) {
    const page = await selectRows(config, table, {
      order: SNAPSHOT_ORDER[table],
      range: { from: offset, to: offset + pageSize - 1 },
    });
    data.push(...page.data);
    if (page.data.length === 0 && offset < expectedCount) {
      throw new Error(`Snapshot pagination stopped early for ${table} at ${offset}/${expectedCount}.`);
    }
  }
  if (data.length !== expectedCount) {
    throw new Error(`Snapshot row mismatch for ${table}: captured ${data.length}, expected ${expectedCount}.`);
  }
  const body = `${JSON.stringify(data || [], null, 2)}\n`;
  const file = path.join(outputDir, `${table}.json`);
  await writeFile(file, body, { encoding: "utf8", mode: 0o600 });
  return {
    table,
    available: true,
    rows: data?.length || 0,
    columns: data?.length ? Object.keys(data[0]).sort() : [],
    sha256: sha256(body),
    file,
  };
}

async function createSnapshot(config) {
  const outputDir = path.join(projectRoot, "tmp", `supabase-reader-audit-${timestamp()}`);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });

  const openApiResponse = await fetch(`${config.url}/rest/v1/`, {
    headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` },
  });
  const openApi = await openApiResponse.text();
  if (!openApiResponse.ok) throw new Error(`Could not snapshot the Data API schema (${openApiResponse.status}).`);
  await writeFile(path.join(outputDir, "rest-openapi.json"), openApi, { encoding: "utf8", mode: 0o600 });

  const tableResults = [];
  for (const table of PRIVATE_TABLES) tableResults.push(await snapshotTable(config, table, outputDir));

  let bucketSummary;
  const storageObjects = {};
  try {
    const { data: buckets } = await apiRequest(config, "/storage/v1/bucket");
    bucketSummary = (buckets || []).map(bucket => ({ id: bucket.id, name: bucket.name, public: bucket.public }));
    for (const bucket of buckets || []) {
      const captured = [];
      const pendingPrefixes = [""];
      const seenPrefixes = new Set();
      while (pendingPrefixes.length) {
        const prefix = pendingPrefixes.shift();
        if (seenPrefixes.has(prefix)) continue;
        seenPrefixes.add(prefix);
        for (let offset = 0; ; offset += 1000) {
          const { data: page } = await apiRequest(config, `/storage/v1/object/list/${encodeURIComponent(bucket.id)}`, {
            method: "POST",
            body: { prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } },
          });
          const objects = page || [];
          for (const item of objects) {
            const fullName = prefix && !String(item.name || "").startsWith(prefix)
              ? `${prefix.replace(/\/$/, "")}/${item.name}`
              : item.name;
            if (item.id) captured.push({ name: fullName, id: item.id, updated_at: item.updated_at });
            else if (item.name) pendingPrefixes.push(`${String(fullName).replace(/\/$/, "")}/`);
          }
          if (objects.length < 1000) break;
          if (offset >= 100000) throw new Error(`Storage pagination exceeded the safety limit for bucket ${bucket.id}.`);
        }
      }
      storageObjects[bucket.id] = [...new Map(captured.map(item => [item.id || item.name, item])).values()]
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }
  } catch (error) {
    bucketSummary = { error: error.message };
  }
  await writeFile(path.join(outputDir, "storage-objects.json"), `${JSON.stringify(storageObjects, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const manifest = {
    createdAt: new Date().toISOString(),
    projectRef: config.projectRef,
    private: true,
    note: "Contains private account data. Keep in the ignored tmp directory and do not commit.",
    openApiSha256: sha256(openApi),
    tables: tableResults,
    storageBuckets: bucketSummary,
    storageObjectCounts: Object.fromEntries(Object.entries(storageObjects).map(([bucket, objects]) => [bucket, objects.length])),
  };
  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { outputDir, manifest };
}

async function manuscriptExposureProbe(config) {
  try {
    const [catalog, serviceContent, anonContent] = await Promise.all([
      selectRows(config, "book_catalog", { columns: "id,status,visibility" }),
      selectRows(config, "book_content_live", { columns: "book_id" }),
      selectRows(config, "book_content_live", { token: config.publishableKey, columns: "book_id" }),
    ]);
    const catalogById = new Map(catalog.data.map(item => [item.id, item]));
    const exposedBeforeReady = anonContent.data
      .map(item => String(item.book_id || ""))
      .filter(bookId => {
        const record = catalogById.get(bookId);
        return !record || record.status !== "ready" || record.visibility === "private";
      })
      .sort();
    return {
      serviceRows: serviceContent.data.length,
      anonRows: anonContent.data.length,
      exposedBeforeReady,
    };
  } catch (error) {
    return { error: `${error.code || ""} ${error.message}`.trim() };
  }
}

async function anonProbe(config, availableTables) {
  const results = [];
  for (const table of availableTables) {
    try {
      const select = await selectRows(config, table, { token: config.publishableKey, head: true, count: true });
      results.push({ table, selectRows: select.count, selectDenied: false, selectError: "" });
    } catch (error) {
      results.push({ table, selectRows: null, selectDenied: true, selectError: `${error.code || ""} ${error.message}`.trim() });
    }
  }
  let publicCatalog;
  try {
    const result = await selectRows(config, "book_catalog", {
      token: config.publishableKey,
      columns: "id",
      head: true,
      count: true,
    });
    publicCatalog = { readable: true, rows: result.count, error: "" };
  } catch (error) {
    publicCatalog = { readable: false, rows: null, error: error.message };
  }
  return {
    privateTables: results,
    publicCatalog,
  };
}

function testRows(userId, marker) {
  const now = new Date().toISOString();
  return {
    saved_books: { user_id: userId, book_id: `rls-${marker}`, saved_at: now, state_changed_at: now, updated_at: now },
    reading_progress: {
      user_id: userId,
      book_id: `rls-${marker}`,
      section_index: 2,
      actual_seconds: 37,
      last_read_at: now,
      updated_at: now,
    },
    completed_books: { user_id: userId, book_id: `rls-${marker}`, completed_at: now, state_changed_at: now },
    reading_sessions: {
      user_id: userId,
      book_id: `rls-${marker}`,
      seconds: 37,
      started_at: now,
      ended_at: now,
      source: "rls-test",
    },
    reader_bookmarks: {
      user_id: userId,
      key: `rls-${marker}::section-2`,
      book_id: `rls-${marker}`,
      section_id: "section-2",
      section_title: "RLS test",
      updated_at: now,
    },
    reader_notes: {
      user_id: userId,
      key: `rls-${marker}::section-2`,
      book_id: `rls-${marker}`,
      section_id: "section-2",
      note: "Temporary RLS test",
      updated_at: now,
    },
    reader_quotes: {
      user_id: userId,
      id: `rls-${marker}`,
      book_id: `rls-${marker}`,
      book_title: "RLS test",
      section_id: "section-2",
      section_title: "RLS test",
      text: "Temporary RLS test",
      saved_at: now,
    },
  };
}

async function signedInClient(config, email, password) {
  const { data } = await apiRequest(config, "/auth/v1/token?grant_type=password", {
    apiKey: config.publishableKey,
    token: config.publishableKey,
    method: "POST",
    body: { email, password },
  });
  if (!data?.access_token) throw new Error("Temporary user sign-in did not return an access token.");
  return data.access_token;
}

async function liveRlsTest(config, availableTables) {
  const marker = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const password = `Jju!${randomBytes(18).toString("base64url")}`;
  const accounts = [
    { email: `jju-rls-a-${marker}@example.invalid`, displayName: "JJU RLS A" },
    { email: `jju-rls-b-${marker}@example.invalid`, displayName: "JJU RLS B" },
  ];
  const createdIds = [];
  const report = { marker, tests: [], cleanup: [] };

  try {
    for (const account of accounts) {
      const { data } = await apiRequest(config, "/auth/v1/admin/users", {
        method: "POST",
        body: {
        email: account.email,
        password,
        email_confirm: true,
        user_metadata: { display_name: account.displayName },
        },
      });
      const user = data?.user || data;
      if (!user?.id) throw new Error("Temporary user creation failed.");
      account.id = user.id;
      createdIds.push(user.id);
    }

    const [userA, userB] = await Promise.all([
      signedInClient(config, accounts[0].email, password),
      signedInClient(config, accounts[1].email, password),
    ]);
    const rows = testRows(accounts[0].id, marker);

    let ownProfile = { data: [], error: null };
    let otherProfile = { data: [], error: null };
    let escalate = { data: [], error: null };
    let crossProfileUpdate = { data: [], error: null };
    let anonProfileUpdate = { data: [], error: null };
    try { ownProfile.data = (await selectRows(config, "profiles", { token: userA, columns: "id,display_name,role", filters: { id: accounts[0].id } })).data; } catch (error) { ownProfile.error = error; }
    try { otherProfile.data = (await selectRows(config, "profiles", { token: userA, columns: "id", filters: { id: accounts[1].id } })).data; } catch (error) { otherProfile.error = error; }
    try { escalate.data = await mutateRows(config, "profiles", { token: userA, method: "PATCH", body: { role: "admin" }, filters: { id: accounts[0].id } }); } catch (error) { escalate.error = error; }
    try { crossProfileUpdate.data = await mutateRows(config, "profiles", { token: userB, method: "PATCH", body: { display_name: "Cross-account write" }, filters: { id: accounts[0].id } }); } catch (error) { crossProfileUpdate.error = error; }
    try { anonProfileUpdate.data = await mutateRows(config, "profiles", { token: config.publishableKey, method: "PATCH", body: { display_name: "Anonymous write" }, filters: { id: accounts[0].id } }); } catch (error) { anonProfileUpdate.error = error; }
    const serviceProfiles = (await selectRows(config, "profiles", { columns: "role", filters: { id: accounts[0].id } })).data;
    report.tests.push({
      test: "profiles",
      ownReadable: !ownProfile.error && ownProfile.data?.length === 1,
      otherHidden: !otherProfile.error && otherProfile.data?.length === 0,
      roleEscalationBlocked: Boolean(escalate.error) || escalate.data?.length === 0,
      crossWriteBlocked: Boolean(crossProfileUpdate.error) || crossProfileUpdate.data?.length === 0,
      anonWriteBlocked: Boolean(anonProfileUpdate.error) || anonProfileUpdate.data?.length === 0,
      storedRole: serviceProfiles[0]?.role || null,
      errors: [ownProfile.error?.message, otherProfile.error?.message, escalate.error?.message, crossProfileUpdate.error?.message, anonProfileUpdate.error?.message].filter(Boolean),
    });

    for (const [table, row] of Object.entries(rows)) {
      if (!availableTables.includes(table)) continue;
      const ownInsert = { data: [], error: null };
      const ownSelect = { data: [], error: null };
      const crossSelect = { data: [], error: null };
      const crossInsert = { data: [], error: null };
      const crossUpdate = { data: [], error: null };
      const anonInsert = { data: [], error: null };
      const anonUpdate = { data: [], error: null };
      const crossWriteRow = { ...row, book_id: `cross-${marker}` };
      if ("key" in crossWriteRow) crossWriteRow.key = `cross-${marker}::section-2`;
      if (table === "reader_quotes") crossWriteRow.id = `cross-${marker}`;
      const anonWriteRow = { ...crossWriteRow, book_id: `anon-${marker}` };
      if ("key" in anonWriteRow) anonWriteRow.key = `anon-${marker}::section-2`;
      if (table === "reader_quotes") anonWriteRow.id = `anon-${marker}`;
      try { ownInsert.data = await mutateRows(config, table, { token: userA, method: "POST", body: row }); } catch (error) { ownInsert.error = error; }
      try { ownSelect.data = (await selectRows(config, table, { token: userA, filters: { user_id: accounts[0].id } })).data; } catch (error) { ownSelect.error = error; }
      try { crossSelect.data = (await selectRows(config, table, { token: userB, filters: { user_id: accounts[0].id } })).data; } catch (error) { crossSelect.error = error; }
      try { crossInsert.data = await mutateRows(config, table, { token: userB, method: "POST", body: crossWriteRow }); } catch (error) { crossInsert.error = error; }
      try { crossUpdate.data = await mutateRows(config, table, { token: userB, method: "PATCH", body: { book_id: `hijack-${marker}` }, filters: { user_id: accounts[0].id } }); } catch (error) { crossUpdate.error = error; }
      try { anonInsert.data = await mutateRows(config, table, { token: config.publishableKey, method: "POST", body: anonWriteRow }); } catch (error) { anonInsert.error = error; }
      try { anonUpdate.data = await mutateRows(config, table, { token: config.publishableKey, method: "PATCH", body: { book_id: `anon-${marker}` }, filters: { user_id: accounts[0].id } }); } catch (error) { anonUpdate.error = error; }
      const serviceCheck = await selectRows(config, table, { columns: "book_id", filters: { user_id: accounts[0].id } });
      report.tests.push({
        test: table,
        ownInsertAllowed: !ownInsert.error && ownInsert.data?.length === 1,
        ownReadable: !ownSelect.error && ownSelect.data?.length >= 1,
        crossReadBlocked: !crossSelect.error && crossSelect.data?.length === 0,
        crossWriteBlocked: (Boolean(crossInsert.error) || crossInsert.data?.length === 0) && (Boolean(crossUpdate.error) || crossUpdate.data?.length === 0),
        anonWriteBlocked: (Boolean(anonInsert.error) || anonInsert.data?.length === 0) && (Boolean(anonUpdate.error) || anonUpdate.data?.length === 0),
        rowUnchanged: serviceCheck.data.some(item => item.book_id === row.book_id),
        errors: [ownInsert.error?.message, ownSelect.error?.message, crossSelect.error?.message, crossInsert.error?.message, crossUpdate.error?.message, anonInsert.error?.message, anonUpdate.error?.message].filter(Boolean),
      });
    }
  } finally {
    for (const id of createdIds.reverse()) {
      try {
        await apiRequest(config, `/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
        report.cleanup.push({ userId: id, removed: true, error: "" });
      } catch (error) {
        report.cleanup.push({ userId: id, removed: false, error: error.message });
      }
    }
  }
  return report;
}

async function main() {
  const config = await loadConfig();
  const { outputDir, manifest } = await createSnapshot(config);
  const availableTables = manifest.tables.filter(item => item.available).map(item => item.table);
  const anon = await anonProbe(config, availableTables);
  const manuscriptExposure = await manuscriptExposureProbe(config);
  const report = {
    projectRef: config.projectRef,
    snapshotDirectory: outputDir,
    snapshotTables: manifest.tables.map(({ table, available, rows, columns, sha256: hash, error }) => ({
      table,
      available,
      rows: rows ?? null,
      columns: columns || [],
      sha256: hash || "",
      error: error || "",
    })),
    storageBuckets: manifest.storageBuckets,
    storageObjectCounts: manifest.storageObjectCounts,
    anon,
    manuscriptExposure,
  };

  if (process.argv.includes("--live-rls-test")) {
    report.liveRlsTest = await liveRlsTest(config, availableTables);
  }

  const reportFile = path.join(outputDir, "audit-report.json");
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
