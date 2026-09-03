# JJ University audiobook and narrator foundation

Date: 2026-08-20
Updated: 2026-09-02

Status: the audiobook/narrator foundation is present in the current Supabase project, with Tacos held in private QA. The contact-roster, deliberate invitation layer, and shareable access-request queue are implemented locally as reviewed additive changes. Their migrations have not been applied, no narrator account was created, and no invitation or owner-notification email was sent in this work.

Tacos rights status: cleared for the JJ University edition on James's September 2, 2026 owner attestation, paired with ACX Client Support's August 19, 2026 written confirmation that former ACX agreements ended and Audible retains no continuing contractual or exclusive distribution rights over removed titles. James is the narrator; Danny Cancino recorded and edited the session. Technical listening/master approval and the act of publishing remain separate.

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
- Private intake and final-audio buckets; neither bucket is public.
- A private contact roster that stays separate from Auth accounts. Adding or importing a contact cannot email anyone or grant portal access.
- A reviewed invitation action that re-checks the exact contact version and email, links an existing confirmed account without email when possible, and otherwise uses a dedicated invite template and welcome/password screen.
- A stable `/narrator/request` entry where a narrator can supply their own name and email. Requests land in a private Workshop queue; approval creates or links a contact but does not send an invitation. The public route has a honeypot, keyed IP throttling, a global ceiling, generic duplicate handling, and no direct database privileges.
- An optional immediate owner notice through Resend. It is disabled unless all notification settings are present, uses the saved request as the only email source, and records delivery state in the private queue.

## Deliberate launch gates

The public audiobook catalog is disabled unless `JJU_AUDIO_CATALOG_ENABLED=1`. Even when enabled, a Listen action appears only when all of these are true:

1. The book has one edition with `status = 'published'`.
2. Its access model is `free` or `account`; subscription access is deliberately blocked until entitlements exist.
3. It has at least one track with `status = 'published'`.

The narrator desk is disabled unless `JJU_NARRATOR_PORTAL_ENABLED=1`. It then requires a verified Supabase account plus a matching narrator profile. Only an `active` profile with a currently open assignment can mutate anything; invited and paused profiles are view-only, and closed assignments are not returned by the portal. Everyone without a narrator profile receives a closed route.

Invitation sending has a second, independent gate: `JJU_NARRATOR_INVITES_ENABLED=1`. Both that switch and the narrator portal must be on before the Workshop can send an invitation. Contact-only imports have their own explicit `JJU_NARRATOR_ROSTER_IMPORT_ENABLED=1` gate and never create Auth users.

The shareable request form has its own `JJU_NARRATOR_ACCESS_REQUESTS_ENABLED=1` gate plus a keyed hashing secret. Opening that form cannot create an account. Owner email notices require `JJU_NARRATOR_REQUEST_NOTIFY_EMAIL`; the existing Resend-backed Supabase SMTP credential and sender can be reused, while `RESEND_API_KEY` and `JJU_NARRATOR_REQUEST_FROM_EMAIL` remain explicit overrides. Missing email settings leave the saved request visible in the Workshop without attempting delivery.

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

1. Review and apply `supabase/jju_narrator_contacts_2026_09_02.sql` without enabling invitations.
2. Review and apply `supabase/jju_narrator_access_requests_2026_09_02.sql`, then configure the owner-notification address before opening the public request switch.
3. Run the contact-only starter import and review Danny's exact record in the Workshop. Keep `/narrator/request` ready for narrators whose email is not already known.
4. Enable invitation sending only for the deliberate Danny test and send the exact reviewed address from his roster card.
5. Let Danny confirm his address and choose his own password; do not generate or share one for him.
6. Create a private Tacos test assignment with an edition key such as `danny-portal-test`; the existing Tacos audio already owns `standard`.
7. Test acceptance, upload, retry, private listen-back, feedback, and replacement on phone and desktop.
8. Keep audiobook publication separate: review the delivery masters, then mark an edition and its tracks published only after that explicit decision.
9. Enable `JJU_AUDIO_CATALOG_ENABLED`; verify the public Listen action, playback, seeking, next-track behavior, and account gating.
10. Add subscriptions only after entitlement, cancellation, refund, and account-deletion behavior are defined and tested.

## Not included yet

- Subscription billing or entitlements.
- Automatic audio transcoding, loudness normalization, silence checks, or ACX-style QA.
- Codec and container inspection. MIME type and byte size are enforced now; actual audio validity remains an explicit review gate before publication.
- Resumable TUS upload UI.
- Narrator contracts, rates, tax forms, or payouts.
- Automatic promotion of narrator intake files into public audiobook tracks. Assignment and review remain intentionally separate from publication.
