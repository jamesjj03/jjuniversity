"use client";

import type { AtlasPatternNote } from "@/lib/atlas-world/geographyTypes";
import styles from "./AtlasWorld.module.css";

type AtlasMapNotesProps = {
  notes: AtlasPatternNote[];
  activeNote: AtlasPatternNote | null;
  onSelect: (note: AtlasPatternNote) => void;
  onClose: () => void;
  onExploreCountry: (entityId: string) => void;
  inactive?: boolean;
};

export default function AtlasMapNotes({
  notes,
  activeNote,
  onSelect,
  onClose,
  onExploreCountry,
  inactive = false,
}: AtlasMapNotesProps) {
  return (
    <div aria-hidden={inactive || undefined} inert={inactive}>
      <details className={styles.noteNavigator} aria-label="Explanations on this map">
        <summary>Four places to look closer <span aria-hidden="true">↗</span></summary>
        <div>
          {notes.map((note, index) => (
            <button
              key={note.id}
              type="button"
              className={activeNote?.id === note.id ? styles.activeNoteButton : ""}
              aria-pressed={activeNote?.id === note.id}
              aria-label={`${index + 1}. ${note.headline}`}
              title={note.headline}
              onClick={() => onSelect(note)}
            >
              {note.headline}
            </button>
          ))}
        </div>
      </details>

      {activeNote && (
        <aside className={styles.noteCard} aria-labelledby="atlas-note-title">
          <div className={styles.noteCardEyebrow}>
            <span>Map explanation</span>
            <button type="button" onClick={onClose} aria-label="Close map explanation">×</button>
          </div>
          <h2 id="atlas-note-title">{activeNote.headline}</h2>
          <p>{activeNote.summary}</p>
          <div className={styles.noteCardActions}>
            {activeNote.spatial.entityIds.length === 1 && (
              <button type="button" onClick={() => onExploreCountry(activeNote.spatial.entityIds[0])}>
                Explore this place
              </button>
            )}
            <details>
              <summary>Evidence & caveats</summary>
              <div>
                {activeNote.evidence.map((evidence) => (
                  <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer">
                    <strong>{evidence.publisher}</strong>
                    <span>{evidence.title}</span>
                  </a>
                ))}
                {activeNote.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
              </div>
            </details>
          </div>
        </aside>
      )}
    </div>
  );
}
