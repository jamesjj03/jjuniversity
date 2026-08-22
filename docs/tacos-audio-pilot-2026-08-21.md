# Everything I Touch Turns to Tacos audio pilot

Date: 2026-08-21
Status: complete local pilot candidate set recovered; duplicated ZIP tracks diagnosed and corrected from Danny's later email; not published

This pilot connects the canonical Reader structure for *Everything I Touch Turns to Tacos* to the recording evidence recovered from James's email and a complete archived local delivery. It does not write to Supabase, apply the audio migration, create storage objects, enable an audio feature flag, or publish an audiobook.

## Verified delivery evidence

A read-only Gmail inspection verified an email from Danny Cancino dated August 15, 2025. The message offered `JJTacos.zip`, approximately 32.5 MB, through Mail Drop. That transfer has expired, but an exact complete archive was subsequently recovered from James's local archived PC backup.

The recovered archive is `32,543,762` bytes with SHA-256 `DDD11C60AB95B918BF302738828BEB6C71970ACA4B060E84DE00184EAD353026`. It was mirrored without altering the source into the Git- and Vercel-ignored local Workshop intake. All 16 real MP3 entries were extracted; macOS resource-fork metadata was intentionally excluded.

The thread also exposed direct MP3 attachment evidence with MIME type `audio/mpeg`. Observed files were roughly 0.9 MB to 5.5 MB and included:

- `10Ch8.cm.mp3`
- `13Tips.cm.mp3`
- `14Acknowledgments.cm.mp3`
- `15AboutTheAuthor.cm.mp3`
- `16ClosingCredits.cm.mp3`

Email attachment metadata does not exactly match the recovered archive at positions 10, 13, 14, 15, and 16. Positions 14 and 15 appeared in two email deliveries; the ZIP matches their smaller earlier copies, while Danny's later message, **More space on the final four files**, contains different and slightly larger files. The later 14 and 15 attachments were recovered locally and proved to be the corrected narrations, not just padded copies. The directly attached 10, 13, and 16 files also have slightly different byte counts from the ZIP versions. Preserve every version, compare hashes, duration, spoken content, and endings, and do not assume that the complete ZIP is automatically the approved master set.

The two recovered corrections are:

- `14Acknowledgments.cm.mp3`: `913,628` bytes, `22.857143` seconds, SHA-256 `7901A1061488AF6EF74321BC0806ECE9EA62DE0AA5073522D8E3CD846394FD6F`;
- `15AboutTheAuthor.cm.mp3`: `1,068,140` bytes, `26.723265` seconds, SHA-256 `5DA4628032F08AC964FE9F774968FC190BE74F22DE5697B6B93173CD06E7966E`.

Offline speech recognition and waveform-envelope comparison show that these later copies match the canonical Acknowledgements and About the Author sections. Their best correlation against the erroneous Tips copies is only `0.2087` and `0.1917`, respectively. They should replace the ZIP's tracks 14 and 15 for the pilot, subject to human listening and mastering QA.

No raw Gmail message IDs or private Gmail links are recorded here. The audio files are local-only under the ignored Workshop intake and are not tracked by Git or deployable through Vercel.

The 16 extracted MP3s total `49,773,704` bytes and `20:45.362`. All are MPEG-1 Layer III, 320 kbps CBR, 44.1 kHz, joint stereo. Every file has contiguous MPEG frames with no gaps, truncation, or unexpected trailing bytes. Their embedded ID3v1.1 tags are not publication-ready: every file reports track 1, artist and album are blank, and titles are production filenames. Canonical order and display titles must come from the server manifest, not the embedded tags.

## Canonical Reader manifest

Run:

```text
npm run audio:manifest -- tacos
```

The read-only tool resolves the selection through both `public/books.json` and `public/book-content/manifest.json`, reads `public/book-content/Tacos.json`, sorts and validates its sections, and removes the same Contents/TOC section the Reader removes. It prints JSON to standard output and does not create a generated file.

Verified local result:

- Catalog ID: `tacos`
- Slug: `everything-i-touch-turns-to-tacos`
- Title: `Everything I Touch Turns to Tacos`
- Canonical source: `public/book-content/Tacos.json`
- Raw source SHA-256: `6a6495d8bb7690e2e7c2afc7ff46a944a760d9b3f19c95378812f254d662d76c`
- Source sections: 17
- Excluded Contents/TOC sections: 1
- Required audio tracks: 16

The tool fails closed when it encounters an unresolved or ambiguous book, a missing or duplicate book ID, a catalog/content mismatch, a missing content file, an invalid section count, a missing or duplicate section ID/index, a gap in section indexes, or no readable sections.

## Complete filename alignment

Removing the Reader's Contents section shifts canonical source index 1 to audio position 1. Under that rule, all 16 filenames form a complete positional sequence. Local offline transcription found one concrete delivery bug: the ZIP's tracks 14 and 15 both recite the same Tips from Max content as track 13. Track 15 is nearly sample-for-sample identical to track 13 and merely adds trailing silence; track 14 is also an extremely high acoustic match. Danny's later email copies fix both duplicates.

| Observed MP3 | Expected position | Canonical section | Finding |
| --- | ---: | --- | --- |
| `10Ch8.cm.mp3` | 10 | Chapter Eight - Back to the Taco Truck | Complete Chapter Eight; chunked recognition recovered the final lines after a whole-file recognizer dropout |
| `13Tips.cm.mp3` | 13 | Tips from Max (Just for Kids) | Correct Tips narration |
| ZIP `14Acknowledgments.cm.mp3` | 14 | Acknowledgements | Wrong content: duplicate of Tips; never publish |
| Email replacement `14Acknowledgments.cm.mp3` | 14 | Acknowledgements | Correct Acknowledgements narration; use as pilot candidate |
| ZIP `15AboutTheAuthor.cm.mp3` | 15 | About the Author | Wrong content: duplicate of Tips with trailing silence; never publish |
| Email replacement `15AboutTheAuthor.cm.mp3` | 15 | About the Author | Correct About the Author narration; use as pilot candidate |
| `16ClosingCredits.cm.mp3` | 16 | Copyright | Correctly combines closing credits with the copyright and fiction disclaimer; display as `Closing Credits & Copyright` |

The complete sequence is strong evidence that Danny's delivery was built around the same 16-position structure now derived from the Reader. It is not a substitute for listening to every file, confirming the approved master versions, or proving that the manuscript has not changed since recording.

## Rights and master-ownership gate

James states that he performed the narration and Danny Cancino recorded and edited it in Danny's professional studio. Before any upload, James and Danny should still confirm in writing:

1. Who performed the narration and who engineered or produced the session.
2. Who owns the recorded masters and whether the studio retains any rights or restrictions.
3. That JJ University may store, copy, edit, transcode, stream, and promote the performance.
4. The agreed narrator credit, compensation or royalty terms, territory, duration, and takedown process.
5. That any music, sound effects, or third-party performances in the recording are cleared.
6. Which files are archival masters and which are approved delivery copies.

An email containing files proves delivery, not the complete rights chain. Do not infer ownership or publication permission from the sender alone.

## Codec and listening QA gate

Container and MPEG-frame validation, local PCM decoding, diagnostic speech recognition, and duplicate-waveform comparison are complete. Publication-level loudness, true-peak, clipping, noise, and human-listening QA remain open. Before publication:

1. Preserve the sealed original archive and recorded filename, byte count, and raw SHA-256 inventory.
2. Measure integrated loudness, true peak, clipping, excessive noise, long unintended silence, and missing starts or endings from the decoded PCM.
3. Listen at every chapter boundary and compare the spoken opening and closing lines with the mapped Reader section.
4. Check loudness and true peak consistently across the edition before producing web-delivery files.
5. Preserve approved masters separately; publish only reviewed delivery derivatives in the private audiobook bucket.

If external audiobook distribution is later planned, run a separate QA pass against that distributor's current requirements rather than treating web playback QA as universal compliance.

## Live-content hash gate

The raw SHA-256 above anchors the exact local bytes inspected on August 21, 2026. Before creating an edition or accepting tracks:

1. Read the current canonical content used by the live Reader, including the current `book_content_live` record when Supabase is authoritative.
2. Compare a stable canonical JSON hash and the complete ordered `{section ID, index, title, kind}` list against the local source used for this manifest.
3. Do not compare raw file bytes directly with database JSON that may have different whitespace or key ordering; use the same stable serialization on both sides.
4. If the live content differs, regenerate the track manifest and require a human to remap every affected recording before upload or publication.
5. Record the approved live-content hash on the planned audio edition so later manuscript edits can trigger review instead of silently drifting from the recording.

## Activation gates

The pilot is ready to advance only in this order:

1. Confirm with Danny that the later email copies of tracks 14 and 15 are the approved corrections and whether the later attachment versions of 10, 13, and 16 supersede the archive copies.
2. Preserve the sealed archive, the corrected email attachments, and every file's exact inventory. Explicitly reject the ZIP copies of tracks 14 and 15 from any publication set.
3. Complete the rights/master-ownership confirmation and use the display title `Closing Credits & Copyright` for position 16 unless human listening finds a reason to split it.
4. Run the live-content hash and ordered-section comparison.
5. Complete codec inspection, full decoding, section-by-section listening, and delivery loudness QA.
6. With James's explicit approval, apply and verify `supabase/jju_audio_foundation_2026_08_20.sql` before any live audio write. Keep both intake and delivery buckets private.
7. Create only the Tacos edition, narrator profile/assignment, and expected-track plan for the tiny pilot. Do not bulk-ingest other narrators.
8. Verify the narrator portal on a phone, including private listen-back, clear expected filenames/sections, upload progress, retry behavior, and cellular interruption recovery.
9. Upload the pilot privately, review it end to end, and test signed playback, seeking, next-track behavior, and access control on phone and desktop.
10. Publish tracks and the edition only after approval. Enable the public audio catalog flag only after the published edition passes the final end-to-end check.

Until all gates pass, the accurate status is: **complete local 16-track pilot candidate set assembled with corrected email tracks 14 and 15; duplicate bug diagnosed; mastering, rights, remaining-version, live-content, and publication review remain; no live audiobook activated.**
