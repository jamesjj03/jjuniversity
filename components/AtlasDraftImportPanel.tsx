"use client";

import { useActionState } from "react";
import { importAtlasDraft, type AtlasDraftImportActionState } from "@/app/admin/atlas/actions";

const INITIAL_STATE: AtlasDraftImportActionState = {
  ok: false,
  message: "",
  errors: [],
  mapIds: [],
};

export default function AtlasDraftImportPanel() {
  const [state, action, pending] = useActionState(importAtlasDraft, INITIAL_STATE);

  return (
    <section className="adminPanel atlasDraftImportPanel" aria-label="Atlas draft import">
      <header className="atlasAdminPanelTop">
        <div>
          <p className="kicker">Draft Intake</p>
          <h2>Import AtlasMapSpec</h2>
        </div>
      </header>

      <form action={action}>
        <label>
          <span>AtlasMapSpec JSON</span>
          <textarea
            name="draftJson"
            spellCheck={false}
            placeholder='{"schemaVersion":1,"updatedAt":"2026-07-08","territories":[...]}'
          />
        </label>

        <div className="atlasDraftImportActions">
          <button className="formBtn" type="submit" disabled={pending}>
            {pending ? "Importing..." : "Import For Review"}
          </button>
          <code>atlas/drafts/economic-schools-atlas-map-spec.json</code>
        </div>
      </form>

      {state.message && (
        <div className={state.ok ? "adminNotice atlasDraftImportNotice success" : "adminNotice atlasDraftImportNotice"}>
          <strong>{state.message}</strong>
          {state.mapIds.length ? <span>{state.mapIds.join(", ")}</span> : null}
        </div>
      )}

      {state.errors.length ? (
        <div className="atlasDraftImportErrors" role="alert">
          {state.errors.map((error, index) => (
            <p key={`${error}-${index}`}>{error}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
