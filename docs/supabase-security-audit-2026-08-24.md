# JJ University Supabase security and continuity audit

Date: 2026-08-24
Project: JJ University (`nzlmnbppynjmutuukmbt`)
Scope: live Supabase database, exposed API schema, Row Level Security, grants, RPCs, Auth, Storage, retained logs, reader data integrity, Workshop catalog writes, audio release state, and post-change isolation testing.

## Outcome

No evidence of an active compromise was found in the retained evidence inspected during this audit. That is not a guarantee that no account or system has ever been attacked; it is a bounded statement about the current state and the logs Supabase retained and exposed during the audit.

The confirmed database and access-control problems found during the review were corrected with fail-closed, versioned migrations. The strengthened final canonical verification returned 17 of 17 checks passed. A separate two-reader rollback-only abuse matrix returned 11 of 11 checks passed. Its transaction was rolled back, and an exact post-state query confirmed four Auth users, 333 catalog books, zero reading sessions, 50 retained reader-canonicalization audit rows, and 235 normalized aliases.

No user was deleted, banned, enrolled in MFA, or forced to reset a password. No manuscript, narrator record, Storage object, paid print job, deployment, or production domain was changed by the audit.

## Live state verified

- All 47 ordinary public-schema tables have Row Level Security enabled; there are zero public partitioned tables.
- All eight Storage tables have Row Level Security enabled.
- No public-schema policy is addressed to the PostgreSQL `PUBLIC` role.
- The anonymous API role has no public RPC execution and no table mutation privileges.
- Authenticated and service-role RPC execution match exact reviewed allowlists.
- All reviewed `SECURITY DEFINER` functions have fixed `public, pg_temp` search paths.
- All four trigger helpers have a fixed `pg_catalog` search path.
- Public-schema default privileges fail closed for untrusted roles.
- Private reader tables returned no anonymous rows.
- Two distinct confirmed readers could see only their own rows across all 13 user-bound surfaces tested.
- Cross-user inserts and updates were rejected; cross-user deletes affected zero rows.
- The public catalog exposed only ready/publicly visible books; hidden and pre-release manuscripts remained unavailable anonymously.
- The `audiobooks` and `narrator-audio-intake` buckets remain private.
- All 16 Tacos track references resolve to private Storage objects.
- All 16 referenced Tacos objects have the expected byte counts; their Storage bytes were not independently SHA-256 re-hashed during this audit.
- No unexpected Auth user appeared. Four pre-existing accounts remain; one is unconfirmed and looks test-related, but was not deleted.

## Live corrections applied

Applied in this order:

1. `jju_print_lulu_columns.sql`
   - Added the already-designed print metadata columns required by the Workshop and print pipeline.
2. `jju_admin_catalog_cas_2026_08_21.sql`
   - Enabled atomic catalog revision compare-and-swap for Supabase-backed Workshop saves and transactional new-book creation.
   - Added fixed search paths and collision checks so slug aliases cannot silently move between books.
3. `jju_tacos_release_gate_correction_2026_08_24.sql`
   - Preserved an exact pre-correction snapshot and moved the Tacos edition plus all 16 tracks from `published` back to `qa`.
   - Left all private audio files intact.
4. `jju_reader_book_id_canonicalization_2026_08_24.sql`
   - Canonicalized the exact 28 legacy mixed-case Reader rows observed in the audit.
   - Used the existing newest-state merge rules for 22 collisions and preserved 50 audit snapshots.
   - Added the seven verified legacy slug aliases.
5. `jju_security_followup_2026_08_24.sql`
   - Revoked unsafe default grants, narrowed function execution, corrected the one policy addressed to `PUBLIC`, fixed function search paths, and constrained `reading_sessions` to the two Reader event shapes.
   - Removed direct client update permission for reading analytics.
   - Added an exact own-user `clear_reading_sessions` RPC.
6. `jju_security_cas_privacy_followup_2026_08_24.sql`
   - Made future public-schema function defaults fail closed and reduced authenticated/service RPC access to exact reviewed allowlists.
   - Revoked direct authenticated writes on catalog and manuscript tables owned by Workshop compare-and-swap flows.
   - Added order-preserving alias synchronization, uniqueness enforcement, and stale-alias removal.
   - Added an atomic manuscript save RPC with an exact version check, per-book lock, history consistency check, and non-empty content-shape constraint.
   - Bound reader-canonicalization audit rows to Auth users with cascade deletion and added an owner-authorized clear RPC.
   - Replaced direct reading inserts with a bounded, catalog-validated, server-normalized, idempotent `record_reading_session` RPC.

The read-only `jju_post_audit_verification_2026_08_24.sql` is the canonical post-application check. Every returned row must show `passed=true`, `failed_checks=0`, and `all_passed=true`.

## Application dependency follow-up

The repository-side production dependency audit initially found four high-severity advisories in the installed Next.js, image-processing, CSS, and ID-generation chain. The review branch was updated to Next.js 16.3.2, React 19.2.8, Sharp 0.35.3, Tailwind/PostCSS 4.3.3, and their patched transitive dependencies. A complete `npm audit` then returned zero known vulnerabilities.

These package corrections belong to the reviewed application build. They do not reach the production website until that exact build is separately promoted; this audit did not promote production.

## Auth changes

- Persistent Auth audit logging to `auth.audit_log_entries` was enabled. It does not backfill older events; the table began empty.
- TOTP authenticator support was enabled for the project.
- No user is currently enrolled: zero MFA factors, zero verified factors, and zero MFA-protected accounts were observed. Project capability is not the same as account protection.
- The enhanced AAL1 session limit is enabled: a user with an enrolled factor must upgrade the session to MFA-verified AAL2 within 15 minutes of initial sign-in. It does not enroll a factor or protect any current account by itself.
- Email remains the only enabled sign-in provider. Email confirmation remains required. Anonymous sign-in remains disabled.
- Refresh-token replay detection remains enabled.

## Residual risks and deliberate holds

### Security Advisor warnings

After the final linter rerun, Security Advisor shows zero errors, 10 warnings, and four informational suggestions.

Nine warnings identify intentionally retained signed-in `SECURITY DEFINER` functions: four own-user clearing RPCs, `is_admin`, three narrator workflow RPCs, and the bounded reading-session recorder. They are not ignored blindly: execution is explicitly allowlisted, identity/ownership checks are inside the functions, and their search paths are fixed. The tenth warning is leaked-password protection, which Supabase currently gates behind a paid plan.

The four informational suggestions are RLS-enabled history/audit tables with no end-user policies. They are intentionally reachable only through reviewed service-role or security-definer paths, so adding broad client policies would weaken rather than improve the boundary.

### Account hardening

- TOTP is available but not yet enrolled or required for any account.
- CAPTCHA is disabled because no provider credentials are configured.
- The current minimum password length remains aligned with the production client. Raising it before the matching UI is promoted would create an avoidable production regression.
- Before bulk narrator ingestion or wider external use, upgrade planning should cover leaked-password protection, Auth retention/session controls, Storage capacity, and operational support.
- Three current sessions were observed across Windows, Android, and an unclassified device class. These are not proof of compromise, but an account owner must recognize the devices; revoke any unfamiliar session.

### Reading analytics

`reading_sessions` is signed-in-only, constrained, catalog-validated, rate-limited, server-time-normalized, idempotent per session ordinal, and user-isolated, but it remains client-reported directional analytics—not billing-grade or anti-fraud telemetry. An authenticated reader can still generate valid-shaped events and erase their own history.

Direct own-row delete remains temporarily available because the current production clients use it. The new clients call `clear_reading_sessions`. After those clients are promoted and verified in production, apply a small follow-up migration that revokes direct `DELETE` and removes the compatibility policy.

### Tacos audio

The edition is QA-only. Objective codec/loudness/continuity checks passed for all 16 files, but human listening approval and explicit publication approval remain pending. Preview access must remain restricted to the exact preview environment, book ID, edition ID, and enabled preview flag. Production publication remains blocked.

### Print

Print data is metadata-only and not for sale. No current release digest binds the public PDFs, deterministic proofs, covers, and last Lulu validation into one approved package. No order or sale should be enabled until the Print Editor gates are reviewed against one regenerated and sealed release.

The public paperbacks bucket has no size cap. Current risk is low because no client upload path was found, but add a cap before widening any upload surface. Add platform rate limiting before enabling dormant quote, checkout, or broader Basic-auth admin entry points.

### Migration and catalog maintenance

The live SQL Editor applications succeeded, but this project has no `supabase_migrations.schema_migrations` ledger. The applied migration files and exact order must remain versioned in Git; future work should establish a migration ledger before making routine schema changes.

All 287 audited catalog word counts differ from manuscript-derived counts. This is an editorial metadata problem, not a security compromise, and should be corrected through its own exact, reviewable data-maintenance pass.

## Repeatable future checks

After every database migration or Auth-policy change:

1. Run `jju_post_audit_verification_2026_08_24.sql` and require zero failures.
2. Repeat the two-reader isolation matrix with reserved test-row IDs, then prove exact cleanup.
3. Recheck Security Advisor and explain every remaining warning.
4. Inspect Auth audit logs and server/API errors for the change window.
5. Confirm all public tables still have RLS and no policy targets `PUBLIC`.
6. Confirm anonymous roles have no mutation or RPC execution.
7. Recheck private Storage buckets and dangling audio references.
8. Verify the deployed reader, account clearing, Workshop exact-CAS conflict path, and phone layout independently.

Relevant Supabase guidance:

- [Database functions and `security definer`](https://supabase.com/docs/guides/database/functions)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api)
- [Auth audit logs](https://supabase.com/docs/guides/auth/audit-logs)
- [Password security](https://supabase.com/docs/guides/auth/password-security)
- [TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp)
- [Database linter](https://supabase.com/docs/guides/database/database-linter)
