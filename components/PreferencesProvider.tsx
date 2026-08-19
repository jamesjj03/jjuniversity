"use client";

import { useEffect } from "react";
import {
  applyPreferencesV2ToDocument,
  PREFERENCES_EVENT,
  readPreferencesV2,
} from "@/lib/preferencesV2";

function applyPreferences() {
  applyPreferencesV2ToDocument(readPreferencesV2());
}

export default function PreferencesProvider() {
  useEffect(() => {
    applyPreferences();
    window.addEventListener(PREFERENCES_EVENT, applyPreferences);
    window.addEventListener("jju-preferences", applyPreferences);
    window.addEventListener("storage", applyPreferences);

    return () => {
      window.removeEventListener(PREFERENCES_EVENT, applyPreferences);
      window.removeEventListener("jju-preferences", applyPreferences);
      window.removeEventListener("storage", applyPreferences);
    };
  }, []);

  return null;
}
