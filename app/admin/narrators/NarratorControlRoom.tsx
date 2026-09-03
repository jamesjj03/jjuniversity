"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  NarratorAdminBook,
  NarratorAdminContact,
  NarratorAdminAccessRequest,
  NarratorAdminSnapshot,
  NarratorAdminSubmission,
} from "@/lib/narratorAdmin";
import styles from "./NarratorControlRoom.module.css";

type Props = {
  snapshot: NarratorAdminSnapshot;
};

type Notice = {
  tone: "success" | "error";
  message: string;
} | null;

function formatDate(value: string) {
  if (!value) return "No due date";
  const calendarDate = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  const date = new Date(calendarDate ? `${calendarDate}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", ...(calendarDate ? { timeZone: "UTC" } : {}) }).format(date);
}

function formatBytes(bytes: number) {
  if (!bytes) return "Size unavailable";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function postAction<T extends Record<string, unknown> = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/admin/narrators", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "The action failed safely.");
  return result;
}

function SubmissionReview({ submission, onChanged }: { submission: NarratorAdminSubmission; onChanged: () => void }) {
  const [feedback, setFeedback] = useState(submission.narratorFeedback);
  const [privateNote, setPrivateNote] = useState(submission.reviewNote);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const reviewable = submission.status === "in-review";

  async function review(decision: "approve" | "request-changes") {
    setBusy(true);
    setNotice(null);
    try {
      await postAction({
        action: "review-submission",
        submissionId: submission.id,
        expectedUpdatedAt: submission.updatedAt,
        decision,
        narratorFeedback: feedback,
        reviewNote: privateNote,
      });
      setNotice({ tone: "success", message: decision === "approve" ? "Track approved. Release is still separate." : "Changes requested. The narrator can replace this track." });
      onChanged();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Review failed safely." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={styles.submissionCard}>
      <header className={styles.cardHeader}>
        <div>
          <span className={styles.status}>{submission.status}</span>
          <h3>{submission.bookTitle}</h3>
          <p>Track {String(submission.trackPosition).padStart(2, "0")} · {submission.trackTitle}</p>
        </div>
        <span className={styles.smallMeta}>{submission.narratorName}</span>
      </header>
      <audio className={styles.audio} controls preload="none" src={`/api/admin/narrators/submissions/${submission.id}/audio`}>
        Your browser cannot play this private recording.
      </audio>
      <div className={styles.fileLine}>
        <span>{submission.fileName || "Private recording"}</span>
        <span>{formatBytes(submission.fileSizeBytes)}</span>
      </div>
      {submission.narratorNote ? <blockquote className={styles.narratorNote}>{submission.narratorNote}</blockquote> : null}
      <div className={styles.reviewFields}>
        <label>
          <span>Message the narrator</span>
          <textarea value={feedback} onChange={event => setFeedback(event.target.value)} maxLength={2000} placeholder="What worked, or exactly what needs another take?" />
        </label>
        <label>
          <span>Private Workshop note</span>
          <textarea value={privateNote} onChange={event => setPrivateNote(event.target.value)} maxLength={2000} placeholder="Optional. Narrators never see this field." />
        </label>
      </div>
      <div className={styles.buttonRow}>
        <button className={styles.primaryButton} type="button" disabled={!reviewable || busy} onClick={() => review("approve")}>Approve track</button>
        <button className={styles.secondaryButton} type="button" disabled={!reviewable || busy || !feedback.trim()} onClick={() => review("request-changes")}>Request changes</button>
      </div>
      {notice ? <p className={notice.tone === "success" ? styles.successNotice : styles.errorNotice} role="status">{notice.message}</p> : null}
      {!reviewable ? <p className={styles.readOnlyNote}>This version is read-only in its current state.</p> : null}
    </article>
  );
}

function AccessRequestCard({
  accessRequest,
  notificationConfigured,
  busy,
  onChanged,
}: {
  accessRequest: NarratorAdminAccessRequest;
  notificationConfigured: boolean;
  busy: boolean;
  onChanged: () => void;
}) {
  const [localBusy, setLocalBusy] = useState<"approve" | "decline" | "">("");
  const [notice, setNotice] = useState<Notice>(null);
  const notificationLabel = accessRequest.notificationStatus === "sent"
    ? "James notified by email"
    : accessRequest.notificationStatus === "failed"
      ? "Email notice failed; request is still safely here"
      : notificationConfigured
        ? "Email notice queued"
        : "Owner email notice is not configured yet";

  async function review(decision: "approve" | "decline") {
    if (decision === "decline" && !window.confirm(`Decline the access request from ${accessRequest.displayName}?`)) return;
    setLocalBusy(decision);
    setNotice(null);
    try {
      await postAction({
        action: "review-access-request",
        requestId: accessRequest.id,
        expectedUpdatedAt: accessRequest.updatedAt,
        decision,
      });
      setNotice({
        tone: "success",
        message: decision === "approve"
          ? "Approved into the private roster. No portal invitation was sent."
          : "Request declined. No account or roster contact was created.",
      });
      onChanged();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "The request could not be reviewed safely." });
    } finally {
      setLocalBusy("");
    }
  }

  return (
    <article className={styles.requestCard}>
      <header className={styles.contactHeader}>
        <div>
          <span className={styles.status}>Pending</span>
          <h3>{accessRequest.displayName}</h3>
          <p>{accessRequest.contactEmail}</p>
        </div>
        <span className={styles.contactState}>{formatDate(accessRequest.createdAt)}</span>
      </header>
      {accessRequest.note ? <blockquote className={styles.requestNote}>{accessRequest.note}</blockquote> : <p className={styles.contactNote}>No note included.</p>}
      <p className={styles.notificationState} data-state={accessRequest.notificationStatus}>{notificationLabel}</p>
      <div className={styles.buttonRow}>
        <button className={styles.primaryButton} type="button" disabled={busy || Boolean(localBusy)} onClick={() => review("approve")}>{localBusy === "approve" ? "Approving…" : "Approve for roster"}</button>
        <button className={styles.secondaryButton} type="button" disabled={busy || Boolean(localBusy)} onClick={() => review("decline")}>{localBusy === "decline" ? "Declining…" : "Decline"}</button>
      </div>
      {notice ? <p className={notice.tone === "success" ? styles.successNotice : styles.errorNotice} role="status">{notice.message}</p> : null}
    </article>
  );
}

function NarratorContactCard({
  contact,
  profileStatus,
  portalEnabled,
  invitesEnabled,
  busy,
  onChanged,
}: {
  contact: NarratorAdminContact;
  profileStatus: string;
  portalEnabled: boolean;
  invitesEnabled: boolean;
  busy: boolean;
  onChanged: () => void;
}) {
  const [displayName, setDisplayName] = useState(contact.displayName);
  const [contactEmail, setContactEmail] = useState(contact.contactEmail);
  const [source, setSource] = useState(contact.source);
  const [notes, setNotes] = useState(contact.notes);
  const [emailChecked, setEmailChecked] = useState(false);
  const [localBusy, setLocalBusy] = useState<"save" | "invite" | "">("");
  const [notice, setNotice] = useState<Notice>(null);
  const linked = Boolean(contact.authUserId);
  const linkedRepair = linked && contact.status === "repair-needed";
  const visibleStatus = ["paused", "closed"].includes(profileStatus) ? profileStatus : contact.status;
  const retryLeaseActive = contact.inviteRetryLocked;
  const editable = !linked && contact.status === "contact";
  const canInvite = Boolean(contact.contactEmail && (linkedRepair || (!linked && ["contact", "invite-pending", "repair-needed"].includes(contact.status))));
  const inviteActionEnabled = (linkedRepair ? portalEnabled : invitesEnabled) && !retryLeaseActive;
  const changed = displayName.trim() !== contact.displayName
    || contactEmail.trim().toLowerCase() !== contact.contactEmail.toLowerCase()
    || source.trim() !== contact.source
    || notes.trim() !== contact.notes;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalBusy("save");
    setNotice(null);
    try {
      await postAction({
        action: "save-contact",
        contactId: contact.id,
        displayName,
        contactEmail,
        source,
        notes,
        expectedUpdatedAt: contact.updatedAt,
      });
      setNotice({ tone: "success", message: "Narrator contact updated. No invitation was sent." });
      onChanged();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Contact update failed safely." });
    } finally {
      setLocalBusy("");
    }
  }

  async function invite() {
    setLocalBusy("invite");
    setNotice(null);
    try {
      const result = await postAction<{ invitation?: { invitationSent?: boolean; invitationRecovered?: boolean; linkedExistingAccount?: boolean } }>({
        action: "invite-contact",
        contactId: contact.id,
        expectedUpdatedAt: contact.updatedAt,
        confirmedEmail: contact.contactEmail,
      });
      setNotice({
        tone: "success",
        message: result.invitation?.invitationSent
          ? `Portal invitation sent to ${contact.contactEmail}.`
          : result.invitation?.invitationRecovered
            ? "The existing invitation was linked and portal setup was repaired without sending another email."
            : "The existing confirmed JJ University account was linked without sending an email.",
      });
      setEmailChecked(false);
      onChanged();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Invitation failed safely." });
      setEmailChecked(false);
      onChanged();
    } finally {
      setLocalBusy("");
    }
  }

  return (
    <article className={styles.contactCard} data-status={visibleStatus}>
      <header className={styles.contactHeader}>
        <div>
          <span className={styles.status}>{visibleStatus}</span>
          <h3>{contact.displayName}</h3>
          <p>{contact.contactEmail || "Email still needed"}</p>
        </div>
        <span className={styles.contactState}>{linked ? "Account linked" : contact.status === "invite-pending" ? "Invitation reserved" : "Contact only"}</span>
      </header>

      {editable ? (
        <details className={styles.contactEdit}>
          <summary>Edit contact</summary>
          <form className={styles.form} onSubmit={save}>
            <label><span>Narrator name</span><input value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={80} required /></label>
            <label><span>Email</span><input type="email" value={contactEmail} onChange={event => { setContactEmail(event.target.value); setEmailChecked(false); }} maxLength={254} /></label>
            <label><span>Where you know them from</span><input value={source} onChange={event => setSource(event.target.value)} maxLength={120} /></label>
            <label><span>Private note</span><textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1200} /></label>
            <button className={styles.secondaryButton} type="submit" disabled={busy || Boolean(localBusy) || !changed}>Save contact</button>
          </form>
        </details>
      ) : null}

      {canInvite ? (
        <div className={styles.inviteBox}>
          <label className={styles.emailCheck}>
            <input type="checkbox" checked={emailChecked} onChange={event => setEmailChecked(event.target.checked)} />
            <span>I checked this exact address: <strong>{contact.contactEmail}</strong></span>
          </label>
          <button className={styles.primaryButton} type="button" disabled={busy || Boolean(localBusy) || !inviteActionEnabled || !emailChecked} onClick={invite}>{linked ? "Finish portal setup" : contact.status === "invite-pending" ? "Retry portal setup" : "Send portal invite"}</button>
          {!inviteActionEnabled ? <small>{retryLeaseActive ? "A setup request is already working. Refresh after ten minutes only if it has not finished." : linkedRepair ? "Turn on the narrator portal to finish this account repair. No new email will be sent." : "Sending stays locked until both the narrator portal and invitation switch are on."}</small> : null}
        </div>
      ) : null}
      {visibleStatus === "invite-sent" ? <p className={styles.contactNote}>Invitation sent. Access begins after the narrator verifies that address.</p> : null}
      {visibleStatus === "invite-pending" ? <p className={styles.contactNote}>Setup did not finish. A retry checks for an existing invitation before it can send anything new.</p> : null}
      {visibleStatus === "repair-needed" ? <p className={styles.contactNote}>Portal setup needs attention. If the original setup email is old, send a fresh account-recovery email before finishing here.</p> : null}
      {visibleStatus === "active" ? <p className={styles.contactNote}>This narrator can enter the private portal.</p> : null}
      {visibleStatus === "paused" ? <p className={styles.contactNote}>Portal access is paused. The account and prior work remain intact.</p> : null}
      {visibleStatus === "closed" ? <p className={styles.contactNote}>Portal access is closed. The account and prior work remain intact.</p> : null}
      {notice ? <p className={notice.tone === "success" ? styles.successNotice : styles.errorNotice} role="status">{notice.message}</p> : null}
    </article>
  );
}

export default function NarratorControlRoom({ snapshot }: Props) {
  const router = useRouter();
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactSource, setContactSource] = useState("Gmail / ACX");
  const [contactNotes, setContactNotes] = useState("");
  const [profileUserId, setProfileUserId] = useState(snapshot.accounts[0]?.id || "");
  const profileByUser = useMemo(() => new Map(snapshot.profiles.map(profile => [profile.userId, profile])), [snapshot.profiles]);
  const selectedProfile = profileByUser.get(profileUserId);
  const selectedAccount = snapshot.accounts.find(account => account.id === profileUserId);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [profileStatusDraft, setProfileStatusDraft] = useState("");
  const displayName = displayNameDraft || selectedProfile?.displayName || selectedAccount?.email.split("@")[0] || "";
  const profileStatus = profileStatusDraft || selectedProfile?.status || "active";
  const activeProfiles = snapshot.profiles.filter(profile => profile.status === "active");
  const [assignmentUserId, setAssignmentUserId] = useState(activeProfiles[0]?.userId || "");
  const effectiveAssignmentUserId = activeProfiles.some(profile => profile.userId === assignmentUserId)
    ? assignmentUserId
    : activeProfiles[0]?.userId || "";
  const [bookQuery, setBookQuery] = useState("");
  const [selectedBook, setSelectedBook] = useState<NarratorAdminBook | null>(null);
  const [editionKey, setEditionKey] = useState("standard");
  const [dueAt, setDueAt] = useState("");
  const [brief, setBrief] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busyAction, setBusyAction] = useState<"contact" | "profile" | "assignment" | "">("");
  const [linkCopied, setLinkCopied] = useState(false);
  const pendingAccessRequests = snapshot.accessRequests.filter(request => request.status === "pending");
  const reviewedAccessRequests = snapshot.accessRequests.filter(request => request.status !== "pending").slice(0, 8);

  const bookResults = useMemo(() => {
    const query = bookQuery.trim().toLowerCase();
    if (query.length < 2) return [];
    return snapshot.books.filter(book => `${book.title} ${book.id}`.toLowerCase().includes(query)).slice(0, 10);
  }, [bookQuery, snapshot.books]);

  function selectProfileUser(userId: string) {
    setProfileUserId(userId);
    setDisplayNameDraft("");
    setProfileStatusDraft("");
    setNotice(null);
  }

  async function addContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("contact");
    setNotice(null);
    try {
      await postAction({
        action: "save-contact",
        displayName: contactName,
        contactEmail,
        source: contactSource,
        notes: contactNotes,
      });
      setContactName("");
      setContactEmail("");
      setContactNotes("");
      setNotice({ tone: "success", message: "Narrator added to the private roster. No invitation was sent." });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Narrator contact could not be saved." });
    } finally {
      setBusyAction("");
    }
  }

  async function copyRequestLink() {
    setNotice(null);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/narrator/request`);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2200);
    } catch {
      setNotice({ tone: "error", message: "The link could not be copied automatically. Use /narrator/request on this site." });
    }
  }

  function chooseBook(book: NarratorAdminBook) {
    setSelectedBook(book);
    setBookQuery(book.title);
    if (book.id === "tacos" && editionKey === "standard") {
      const narratorName = activeProfiles.find(profile => profile.userId === effectiveAssignmentUserId)?.displayName || "narrator";
      const narratorKey = narratorName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "narrator";
      setEditionKey(`${narratorKey}-portal-test`.slice(0, 48));
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("profile");
    setNotice(null);
    try {
      await postAction({
        action: "save-profile",
        userId: profileUserId,
        displayName,
        status: profileStatus,
        expectedUpdatedAt: selectedProfile?.updatedAt || "",
      });
      setNotice({ tone: "success", message: selectedProfile ? "Narrator profile updated." : "Narrator account activated." });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Profile save failed safely." });
    } finally {
      setBusyAction("");
    }
  }

  async function createAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("assignment");
    setNotice(null);
    try {
      await postAction({
        action: "create-assignment-plan",
        userId: effectiveAssignmentUserId,
        bookId: selectedBook?.id || "",
        editionKey,
        dueAt,
        brief,
      });
      setNotice({ tone: "success", message: "Assignment offered with one exact track per Reader section." });
      setSelectedBook(null);
      setBookQuery("");
      setBrief("");
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Assignment setup failed safely." });
    } finally {
      setBusyAction("");
    }
  }

  if (!snapshot.available) {
    return (
      <section className={styles.errorPanel} role="alert">
        <strong>Control room unavailable</strong>
        <p>{snapshot.message}</p>
      </section>
    );
  }

  return (
    <>
      <section className={styles.portalBanner} aria-labelledby="portal-state-title">
        <span className={snapshot.portalEnabled ? styles.enabledBadge : styles.disabledBadge}>{snapshot.portalEnabled ? "Narrator portal on" : "Narrator portal off"}</span>
        <div>
          <h2 id="portal-state-title">The private workroom is {snapshot.portalEnabled ? "available to active narrators" : "currently hidden from narrators"}.</h2>
          <p>{snapshot.invitesEnabled ? "You can deliberately send one reviewed invitation from the roster." : "Invitations are locked, so roster work cannot accidentally email anybody."} This desk cannot publish an audiobook or declare a production master.</p>
        </div>
      </section>

      <section className={styles.releaseFence} aria-label="Audio approval boundaries">
        <div><strong>Reader plan</strong><span>Pinned here</span></div>
        <div><strong>Performance</strong><span>Track review here</span></div>
        <div><strong>Rights + master</strong><span>Separate approval</span></div>
        <div><strong>Publication</strong><span>Unavailable here</span></div>
      </section>

      {notice ? <p className={notice.tone === "success" ? styles.successNotice : styles.errorNotice} role="status">{notice.message}</p> : null}

      <section className={styles.section} aria-labelledby="access-requests-title">
        <header className={styles.sectionHeader}>
          <div><span>Shareable entry</span><h2 id="access-requests-title">Narrator access requests</h2></div>
          <p>{pendingAccessRequests.length} waiting</p>
        </header>

        <div className={styles.requestLinkBox}>
          <div>
            <strong>One link for any narrator</strong>
            <p>They enter their own email. Approval adds them to the reviewed roster; sending the actual portal invitation stays separate.</p>
          </div>
          <code>/narrator/request</code>
          <button className={styles.secondaryButton} type="button" onClick={copyRequestLink}>{linkCopied ? "Copied" : "Copy link"}</button>
        </div>

        {!snapshot.accessRequestsAvailable ? (
          <div className={styles.emptyState}><strong>The request queue is designed but not installed yet.</strong><p>The current narrator roster and portal remain untouched. Install the additive request migration before opening this link.</p></div>
        ) : pendingAccessRequests.length ? (
          <div className={styles.requestList}>
            {pendingAccessRequests.map(accessRequest => (
              <AccessRequestCard
                key={accessRequest.id}
                accessRequest={accessRequest}
                notificationConfigured={snapshot.requestNotificationConfigured}
                busy={Boolean(busyAction)}
                onChanged={() => router.refresh()}
              />
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}><strong>No one is waiting.</strong><p>New requests will appear here with the exact name, email, note, and notification state that were submitted.</p></div>
        )}

        {reviewedAccessRequests.length ? (
          <details className={styles.reviewedRequests}>
            <summary>Recently reviewed requests</summary>
            <ul>
              {reviewedAccessRequests.map(accessRequest => (
                <li key={accessRequest.id}>
                  <span><strong>{accessRequest.displayName}</strong>{accessRequest.contactEmail}</span>
                  <em data-status={accessRequest.status}>{accessRequest.status}</em>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <div className={styles.setupGrid}>
        <section className={styles.panel} aria-labelledby="contact-title">
          <header className={styles.panelHeader}>
            <span>Step 1</span>
            <h2 id="contact-title">Add a narrator</h2>
            <p>Save a private contact first. This does not create an account or send an email.</p>
          </header>
          {snapshot.contactsAvailable ? (
            <form className={styles.form} onSubmit={addContact}>
              <label><span>Narrator name</span><input value={contactName} onChange={event => setContactName(event.target.value)} maxLength={80} placeholder="Danny Cancino" required /></label>
              <label><span>Email, if verified</span><input type="email" value={contactEmail} onChange={event => setContactEmail(event.target.value)} maxLength={254} placeholder="narrator@example.com" /></label>
              <label><span>Where you know them from</span><input value={contactSource} onChange={event => setContactSource(event.target.value)} maxLength={120} /></label>
              <label><span>Private note</span><textarea value={contactNotes} onChange={event => setContactNotes(event.target.value)} maxLength={1200} placeholder="Completed books, preferred contact route, or anything worth remembering." /></label>
              <button className={styles.primaryButton} disabled={busyAction === "contact" || !contactName.trim()} type="submit">Add to private roster</button>
            </form>
          ) : <p className={styles.emptyText}>The private roster is designed but has not been installed in this environment yet.</p>}
        </section>

      </div>

      <section className={styles.section} aria-labelledby="roster-title">
        <header className={styles.sectionHeader}>
          <div><span>Step 2 · Private roster</span><h2 id="roster-title">Review, then invite</h2></div>
          <p>{snapshot.contacts.length} contact{snapshot.contacts.length === 1 ? "" : "s"} · {snapshot.profiles.length} portal profile{snapshot.profiles.length === 1 ? "" : "s"}</p>
        </header>
        {!snapshot.contactsAvailable ? (
          <div className={styles.emptyState}><strong>The roster upgrade is not installed yet.</strong><p>Existing narrator accounts and assignments are untouched. Install the reviewed additive migration before adding contacts.</p></div>
        ) : snapshot.contacts.length ? (
          <div className={styles.contactList}>
            {snapshot.contacts.map(contact => (
              <NarratorContactCard
                key={contact.id}
                contact={contact}
                profileStatus={contact.authUserId ? profileByUser.get(contact.authUserId)?.status || "" : ""}
                portalEnabled={snapshot.portalEnabled}
                invitesEnabled={snapshot.invitesEnabled}
                busy={Boolean(busyAction)}
                onChanged={() => router.refresh()}
              />
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}><strong>No narrator contacts yet.</strong><p>Add Danny first. He can stay contact-only until you deliberately send the portal invitation.</p></div>
        )}

        <details className={styles.existingAccounts}>
          <summary>Already has a JJ University account?</summary>
          <div className={styles.existingAccountsBody}>
            <p>Use this only for somebody who already confirmed an account. It links access without sending an email.</p>
            {snapshot.accounts.length ? (
              <form className={styles.form} onSubmit={saveProfile}>
                <label>
                  <span>Confirmed account</span>
                  <select value={profileUserId} onChange={event => selectProfileUser(event.target.value)}>
                    {snapshot.accounts.map(account => {
                      const profile = profileByUser.get(account.id);
                      return <option key={account.id} value={account.id}>{account.email}{profile ? ` · ${profile.status}` : ""}</option>;
                    })}
                  </select>
                </label>
                <label><span>Narrator name</span><input value={displayName} onChange={event => setDisplayNameDraft(event.target.value)} maxLength={80} required /></label>
                <label>
                  <span>Portal status</span>
                  <select value={profileStatus} onChange={event => setProfileStatusDraft(event.target.value)}>
                    <option value="active">Active</option>
                    <option value="invited">Invited</option>
                    <option value="paused">Paused</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <button className={styles.secondaryButton} disabled={busyAction === "profile" || !profileUserId} type="submit">{selectedProfile ? "Update narrator" : "Link narrator"}</button>
              </form>
            ) : <p className={styles.emptyText}>No confirmed unlinked accounts are available.</p>}
          </div>
        </details>
      </section>

      <section className={`${styles.panel} ${styles.assignmentPanel}`} aria-labelledby="assignment-title">
        <header className={styles.panelHeader}>
          <span>Step 3</span>
          <h2 id="assignment-title">Offer a Reader-mapped book</h2>
          <p>One required audio track is created for each current Reader section. The exact manuscript hash is stored with the edition.</p>
        </header>
        {activeProfiles.length ? (
          <form className={styles.form} onSubmit={createAssignment}>
            <label>
              <span>Active narrator</span>
              <select value={effectiveAssignmentUserId} onChange={event => setAssignmentUserId(event.target.value)}>
                {activeProfiles.map(profile => <option key={profile.userId} value={profile.userId}>{profile.displayName}</option>)}
              </select>
            </label>
            <div className={styles.bookPicker}>
              <label>
                <span>Find a book</span>
                <input value={bookQuery} onChange={event => { setBookQuery(event.target.value); setSelectedBook(null); }} placeholder="Type at least 2 letters" autoComplete="off" />
              </label>
              {selectedBook ? <p className={styles.selectedBook}><span>Selected</span><strong>{selectedBook.title}</strong><button type="button" onClick={() => { setSelectedBook(null); setBookQuery(""); }}>Change</button></p> : null}
              {!selectedBook && bookResults.length ? (
                <div className={styles.bookResults} role="listbox" aria-label="Matching books">
                  {bookResults.map(book => (
                    <button key={book.id} type="button" role="option" aria-selected="false" onClick={() => chooseBook(book)}>
                      <strong>{book.title}</strong><span>{book.id}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className={styles.splitFields}>
              <label><span>Edition key</span><input value={editionKey} onChange={event => setEditionKey(event.target.value)} maxLength={48} required /></label>
              <label><span>Due date</span><input type="date" value={dueAt} onChange={event => setDueAt(event.target.value)} /></label>
            </div>
            <label><span>Narrator brief</span><textarea value={brief} onChange={event => setBrief(event.target.value)} maxLength={4000} placeholder="Pronunciation, tone, pacing, and delivery notes." /></label>
            <button className={styles.primaryButton} disabled={busyAction === "assignment" || !selectedBook || !effectiveAssignmentUserId} type="submit">Create plan and offer assignment</button>
          </form>
        ) : <p className={styles.emptyText}>Invite and activate a narrator first. Nothing has been offered.</p>}
      </section>

      <section className={styles.section} aria-labelledby="motion-title">
        <header className={styles.sectionHeader}>
          <div><span>Private workflow</span><h2 id="motion-title">Work in motion</h2></div>
          <p>{snapshot.assignments.length} assignment{snapshot.assignments.length === 1 ? "" : "s"} · {snapshot.editions.length} edition{snapshot.editions.length === 1 ? "" : "s"}</p>
        </header>
        {snapshot.editions.length ? (
          <div className={styles.assignmentList}>
            {snapshot.editions.map(edition => {
              const assignment = snapshot.assignments.find(item => item.editionId === edition.id);
              return (
                <article className={styles.assignmentCard} key={edition.id}>
                  <header className={styles.cardHeader}>
                    <div>
                      <span className={styles.status}>{assignment?.status || edition.status}</span>
                      <h3>{edition.bookTitle}</h3>
                      <p>{assignment ? `${assignment.narratorName} · ${formatDate(assignment.dueAt)}` : `${edition.narratorName || "No narrator"} · No assignment attached`}</p>
                    </div>
                    <span className={styles.smallMeta}>{edition.tracks.length} Reader tracks</span>
                  </header>
                  {assignment?.brief ? <p className={styles.brief}>{assignment.brief}</p> : null}
                  <details className={styles.trackDetails}>
                    <summary>See exact Reader track plan</summary>
                    <ol>
                      {edition.tracks.map(track => <li key={track.id}><span>{String(track.position).padStart(2, "0")}</span><div><strong>{track.title}</strong><small>{track.sectionKey}</small></div></li>)}
                    </ol>
                  </details>
                  <p className={styles.hash}>Manuscript: {edition.sourceContentVersion ? `Supabase v${edition.sourceContentVersion} · ` : ""}{edition.sourceContentSha256.slice(0, 12) || "hash unavailable"}</p>
                </article>
              );
            })}
          </div>
        ) : <div className={styles.emptyState}><strong>No narrator editions or assignments yet.</strong><p>This is a real zero, not a hidden or estimated count.</p></div>}
      </section>

      <section className={styles.section} aria-labelledby="submissions-title">
        <header className={styles.sectionHeader}>
          <div><span>Listen-back</span><h2 id="submissions-title">Private submissions</h2></div>
          <p>{snapshot.submissions.length} submitted file{snapshot.submissions.length === 1 ? "" : "s"}</p>
        </header>
        {snapshot.submissions.length ? (
          <div className={styles.submissionList}>{snapshot.submissions.map(submission => <SubmissionReview key={submission.id} submission={submission} onChanged={() => router.refresh()} />)}</div>
        ) : <div className={styles.emptyState}><strong>No narrator submissions yet.</strong><p>Recordings will appear only after an active narrator accepts an assignment and uploads a verified private file.</p></div>}
      </section>
    </>
  );
}
