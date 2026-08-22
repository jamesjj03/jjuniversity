# JJ University audiobook and narrator foundation

Date: 2026-08-20
Updated: 2026-08-21

Status: implemented in code as a disabled-safe foundation. The SQL has not been applied and no live Supabase data or Storage buckets were changed.

## What exists now

- A first-class audiobook edition model separate from the book catalog.
- Ordered track metadata and a private streaming boundary.
- A book action component that supports Read, Listen, Print, and Save without showing Listen for incomplete data.
- A native audiobook page and single-player track list.
- A private, phone-first narrator desk with assignment acceptance, a server-authored expected-page checklist, local preview, private listen-back, versioned replacement, narrator-visible feedback, and a submit-for-review action that stays locked until every required track is ready.
- Server-verified, short-lived signed upload tokens. Narrators never receive the service-role key or direct access to another narrator's files.
- Transactional database functions for accepting assignments, preparing uploads, and submitting work for review. Narrator accounts have read-only table access; they cannot insert or update submission records directly. The completion transaction is callable only by the server's service role after the route verifies the real Storage object.
- Narrator reads are column-scoped as well as row-scoped. Internal assignment notes and submission review notes are withheld from direct narrator queries until a deliberate feedback surface exists.
- Active narrator profiles are locked for each mutation transaction, preventing a concurrent pause/closure from racing past the authorization check.
- Retry-safe upload preparation. The browser creates one idempotency key per unchanged file/track/note attempt, and a retry returns the same private submission instead of creating a duplicate.
- Reader-aligned track identity. Narrators choose an expected track; the server derives its position and title from that edition rather than trusting hand-entered metadata.
- Private intake and final-audio buckets in the reviewed SQL draft.

## Deliberate launch gates

The public audiobook catalog is disabled unless `JJU_AUDIO_CATALOG_ENABLED=1`. Even when enabled, a Listen action appears only when all of these are true:

1. The book has one edition with `status = 'published'`.
2. Its access model is `free` or `account`; subscription access is deliberately blocked until entitlements exist.
3. It has at least one track with `status = 'published'`.

The narrator desk is disabled unless `JJU_NARRATOR_PORTAL_ENABLED=1`. It then requires a verified Supabase account plus a matching narrator profile. Only an `active` profile with a currently open assignment can mutate anything; invited and paused profiles are view-only, and closed assignments are not returned by the portal. Everyone without a narrator profile receives a closed route.

## Supabase recommendation

Use Supabase Pro before narrator ingestion begins. The current Free plan includes 1 GB of file storage, 5 GB of ordinary egress, 5 GB of cached egress, and a 50 MB maximum upload size. Pro starts at $25/month and includes 100 GB of file storage plus 250 GB ordinary and 250 GB cached egress. Sources: [Supabase pricing](https://supabase.com/pricing), [billing quotas](https://supabase.com/docs/guides/platform/billing-on-supabase), and [Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits).

Compressed audiobook capacity makes the boundary clear:

| Library scenario | 64 kbps mono | 96 kbps mono | 128 kbps |
| --- | ---: | ---: | ---: |
| One 30-minute book | 14.4 MB | 21.6 MB | 28.8 MB |
| 200 narrated books at 30 minutes each | 2.88 GB | 4.32 GB | 5.76 GB |
| 320 books at 30 minutes each | 4.61 GB | 6.91 GB | 9.22 GB |

That means Free cannot hold the already-described narrated library. At 64 kbps, its 5 GB ordinary egress is only about 347 complete 30-minute listens before the ordinary egress quota is reached. Pro's 250 GB ordinary allowance is roughly 17,000 such listens before overage, ignoring any benefit from cached delivery.

Store delivery audio in Supabase, one chapter per file. Keep archival WAV masters out of the public delivery bucket; uncompressed masters can consume tens of gigabytes even for the current collection. The narrator intake bucket can accept temporary masters once Pro is active, but the final `audiobooks` bucket should contain approved web-delivery files.

Supabase recommends resumable TUS uploads for files over 6 MB or unstable connections. The current lightweight uploader uses signed standard uploads and caps each track at 50 MB so it works within Free-plan rules during a tiny pilot. Before broad narrator onboarding, replace the transfer step with TUS while keeping the same assignment and submission tables. Source: [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads).

## Storage and access model

- `narrator-audio-intake`: private. A narrator receives a path-specific signed upload token only after a transaction confirms an active profile and open assignment. Completion hardcodes this bucket and the exact `{userId}/{assignmentId}/` path prefix, then verifies the stored object's non-zero byte size against the prepared submission before advancing state.
- `audiobooks`: private. The public player requests a short-lived signed playback URL only after the edition and track are confirmed published.
- `free`: no account is required, but the physical object remains private.
- `account`: a verified JJ University account is required.
- `subscription`: blocked until a real entitlement table and payment lifecycle exist.

Supabase notes that signed URLs stay valid until expiration and that generating unique signed URLs reduces CDN cache reuse. If every audiobook ultimately remains free, a separate public delivery bucket is the more efficient final configuration. If subscriptions are introduced, keep restricted editions private and authorize each stream server-side. Sources: [serving private assets](https://supabase.com/docs/guides/storage/serving/downloads) and [signed URLs with Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn).

## Activation sequence

1. Review and apply `supabase/jju_audio_foundation_2026_08_20.sql` in a non-production check first.
2. Upgrade Supabase to Pro before bulk audio arrives.
3. Create one real narrator account, narrator profile, edition, Reader-aligned expected-track plan, and assignment. Pin the edition to the approved manuscript version and content hash.
4. Enable only `JJU_NARRATOR_PORTAL_ENABLED` and test acceptance, upload, retry, and submission on phone and desktop.
5. Review the uploaded source, create delivery MP3/M4A tracks, and insert them in the final private bucket.
6. Mark the edition and its tracks published.
7. Enable `JJU_AUDIO_CATALOG_ENABLED`; verify the Listen action, playback, seeking, next-track behavior, and account gating.
8. Add subscriptions only after entitlement, cancellation, refund, and account-deletion behavior are defined and tested.

## Not included yet

- Subscription billing or entitlements.
- Automatic audio transcoding, loudness normalization, silence checks, or ACX-style QA.
- Codec and container inspection. MIME type and byte size are enforced now; actual audio validity remains an explicit review gate before publication.
- Resumable TUS upload UI.
- Narrator contracts, rates, tax forms, or payouts.
- Admin controls for inviting narrators, generating the expected-track rows from a reviewed Reader manifest, and promoting intake files to published tracks; those belong in the admin redesign.
