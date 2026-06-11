"use client";

import { DragEvent, useEffect, useState } from "react";
import Link from "next/link";

type CardMode = "clean" | "dark" | "library";

const modes: Array<{ id: CardMode; label: string }> = [
  { id: "clean", label: "Clean" },
  { id: "dark", label: "Dark" },
  { id: "library", label: "JJU" },
];

const STORAGE_KEY = "jjuFiberQrImage";

export default function FiberQrPage() {
  const [qrSrc, setQrSrc] = useState("");
  const [mode, setMode] = useState<CardMode>("clean");
  const [presenting, setPresenting] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) queueMicrotask(() => setQrSrc(saved));
    } catch {}
  }, []);

  function loadFile(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const next = String(reader.result || "");
      setQrSrc(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {}
    };
    reader.readAsDataURL(file);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    loadFile(event.dataTransfer.files?.[0]);
  }

  const card = (
    <section className={`fiberQrCard fiberQrCard-${mode}`} aria-label="Fiber QR code card">
      <div className="fiberQrTopMark">
        <img src="/branding/jju-logo.png" alt="JJ University" />
        <span>JJ University</span>
      </div>

      <div className="fiberQrMainCopy">
        <p>Scan for fiber quote</p>
        <h1>Compare your bill.</h1>
      </div>

      <div className="fiberQrBox">
        {qrSrc ? (
          <img src={qrSrc} alt="Fiber QR code" />
        ) : (
          <div className="fiberQrEmpty">
            <span>Drop QR here</span>
            <small>or upload from the iPad</small>
          </div>
        )}
      </div>

      <p className="fiberQrUrl">jjuniversity.com/fiber</p>
    </section>
  );

  return (
    <main className="fiberQrPage fiberQrPrivatePage">
      <section className="fiberQrPrivateShell">
        <div className="fiberQrPrivateHeader">
          <img src="/branding/jju-logo.png" alt="JJ University" />
          <div>
            <p>Private fiber tool</p>
            <h1>QR display</h1>
          </div>
        </div>

        <div className="fiberQrModeRow" aria-label="QR card styles">
          {modes.map(item => (
            <button key={item.id} className={item.id === mode ? "active" : ""} onClick={() => setMode(item.id)} type="button">
              {item.label}
            </button>
          ))}
        </div>

        <label className="fiberQrDrop" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <input type="file" accept="image/*" onChange={(event) => loadFile(event.target.files?.[0])} />
          <span>{qrSrc ? "Replace QR image" : "Upload QR image"}</span>
          <small>Stored locally on this device.</small>
        </label>

        <div className="fiberQrPreviewWrap">
          {card}
        </div>

        <div className="fiberQrActionRow">
          <button className="fiberQrPresentBtn" onClick={() => setPresenting(true)} type="button">Present full screen</button>
          <Link href="/fiber" className="fiberQrBack">Back to fiber</Link>
        </div>
      </section>

      {presenting && (
        <div className="fiberQrPresenter" role="dialog" aria-modal="true">
          <button onClick={() => setPresenting(false)} aria-label="Close full screen QR display">Close</button>
          {card}
        </div>
      )}
    </main>
  );
}
