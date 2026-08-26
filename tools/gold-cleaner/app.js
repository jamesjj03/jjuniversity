const state = {
  books: [],
  book: null,
  selectedBookId: "",
  selectedSectionIndex: 0,
  selectedBooks: new Set(),
  accepted: new Map(),
  config: null,
  drafts: { sections: new Set(), exports: new Set() },
  stopRequested: false,
  runningBatch: false,
};

const el = {
  providerStatus: document.querySelector("#providerStatus"),
  refreshBtn: document.querySelector("#refreshBtn"),
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  providerSelect: document.querySelector("#providerSelect"),
  modelInput: document.querySelector("#modelInput"),
  apiTokenInput: document.querySelector("#apiTokenInput"),
  saveTokenBtn: document.querySelector("#saveTokenBtn"),
  skipSavedInput: document.querySelector("#skipSavedInput"),
  scopeSelect: document.querySelector("#scopeSelect"),
  runScopeBtn: document.querySelector("#runScopeBtn"),
  queueEstimate: document.querySelector("#queueEstimate"),
  draftSummary: document.querySelector("#draftSummary"),
  auditSource: document.querySelector("#auditSource"),
  selectVisibleBtn: document.querySelector("#selectVisibleBtn"),
  clearSelectedBtn: document.querySelector("#clearSelectedBtn"),
  selectedCount: document.querySelector("#selectedCount"),
  bookList: document.querySelector("#bookList"),
  bookKicker: document.querySelector("#bookKicker"),
  bookTitle: document.querySelector("#bookTitle"),
  bookStats: document.querySelector("#bookStats"),
  sectionSelect: document.querySelector("#sectionSelect"),
  cleanBtn: document.querySelector("#cleanBtn"),
  testBtn: document.querySelector("#testBtn"),
  runBookBtn: document.querySelector("#runBookBtn"),
  runAllBtn: document.querySelector("#runAllBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  acceptBtn: document.querySelector("#acceptBtn"),
  rejectBtn: document.querySelector("#rejectBtn"),
  saveBtn: document.querySelector("#saveBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  applyLiveBtn: document.querySelector("#applyLiveBtn"),
  originalPreview: document.querySelector("#originalPreview"),
  originalText: document.querySelector("#originalText"),
  cleanEditor: document.querySelector("#cleanEditor"),
  cleanText: document.querySelector("#cleanText"),
  blockPBtn: document.querySelector("#blockPBtn"),
  blockH2Btn: document.querySelector("#blockH2Btn"),
  blockH3Btn: document.querySelector("#blockH3Btn"),
  italicBtn: document.querySelector("#italicBtn"),
  quoteBtn: document.querySelector("#quoteBtn"),
  sourceToggleBtn: document.querySelector("#sourceToggleBtn"),
  originalMeta: document.querySelector("#originalMeta"),
  cleanMeta: document.querySelector("#cleanMeta"),
  styleGuide: document.querySelector("#styleGuide"),
  saveGuideBtn: document.querySelector("#saveGuideBtn"),
  notice: document.querySelector("#notice"),
};

let sourceMode = false;

function notice(message) {
  el.notice.textContent = message;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function words(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}

function plainText(html = "") {
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function residueFor(text) {
  const raw = String(text || "");
  const emDash = (raw.match(/—|â€”/g) || []).length;
  const filler = [
    /\bin many ways\b/gi,
    /\bnot only\b/gi,
    /\bbut also\b/gi,
    /\bit was not just\b/gi,
    /\bmore than just\b/gi,
    /\bin essence\b/gi,
  ].reduce((sum, pattern) => sum + (raw.match(pattern) || []).length, 0);
  return { emDash, score: emDash + filler * 5 };
}

function sectionKey(bookId, sectionIndex) {
  return `${bookId}::${Number(sectionIndex)}`;
}

function sectionText(section) {
  return section?.text || plainText(section?.html || "");
}

function sectionHtml(section) {
  return section?.html || section?.text || "";
}

function draftFromHtml(cleanedHtml) {
  const html = String(cleanedHtml || "").trim();
  return {
    cleanedHtml: html,
    cleanedText: plainText(html),
  };
}

function draftText(draft) {
  if (!draft) return "";
  if (typeof draft === "string") return draft;
  return draft.cleanedHtml || draft.cleanedText || "";
}

function setOriginalHtml(html) {
  el.originalText.value = html || "";
  el.originalPreview.innerHTML = html || "";
}

function setCleanHtml(html) {
  const next = html || "";
  el.cleanText.value = next;
  el.cleanEditor.innerHTML = next;
}

function getCleanHtml() {
  if (sourceMode) {
    el.cleanEditor.innerHTML = el.cleanText.value;
    return el.cleanText.value.trim();
  }
  el.cleanText.value = el.cleanEditor.innerHTML;
  return el.cleanEditor.innerHTML.trim();
}

function syncCleanSource() {
  if (!sourceMode) el.cleanText.value = el.cleanEditor.innerHTML;
}

function runEditorCommand(command, value) {
  if (sourceMode) return;
  el.cleanEditor.focus();
  document.execCommand(command, false, value);
  syncCleanSource();
}

function setSourceMode(next) {
  sourceMode = next;
  if (sourceMode) {
    el.cleanText.value = el.cleanEditor.innerHTML;
    el.cleanText.classList.remove("hidden");
    el.cleanEditor.classList.add("hidden");
    el.sourceToggleBtn.textContent = "Preview";
  } else {
    el.cleanEditor.innerHTML = el.cleanText.value;
    el.cleanEditor.classList.remove("hidden");
    el.cleanText.classList.add("hidden");
    el.sourceToggleBtn.textContent = "HTML";
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanupSections(book) {
  return (book.sections || [])
    .map((section, index) => ({ section, index, text: sectionText(section), html: sectionHtml(section) }))
    .filter(item => words(item.text) >= 40 && !["toc"].includes(String(item.section.kind || "").toLowerCase()));
}

function setBatchDisabled(disabled) {
  state.runningBatch = disabled;
  [el.cleanBtn, el.testBtn, el.runBookBtn, el.runAllBtn, el.runScopeBtn, el.acceptBtn, el.rejectBtn, el.saveBtn, el.exportBtn, el.applyLiveBtn].forEach(button => {
    button.disabled = disabled;
  });
  el.stopBtn.disabled = !disabled;
}

function updateEstimate() {
  const queue = sweepOrder();
  const rough = queue.filter(book => book.status !== "Gold sample");
  const over10 = state.books.filter(book => Number(book.emDash || 0) > 10);
  const wordsTotal = queue.reduce((sum, book) => sum + Number(book.wordCount || 0), 0);
  const roughWords = rough.reduce((sum, book) => sum + Number(book.wordCount || 0), 0);
  const roughTokens = Math.ceil(roughWords * 1.45 * 2);
  const allTokens = Math.ceil(wordsTotal * 1.45 * 2);
  el.queueEstimate.textContent = `Queue: ${rough.length} non-Gold books, ${over10.length} books over 10 em dashes, ${queue.length - rough.length} Gold samples. Non-Gold text approx ${roughWords.toLocaleString()} words / ${roughTokens.toLocaleString()} input+output tokens. All books approx ${wordsTotal.toLocaleString()} words / ${allTokens.toLocaleString()} tokens.`;
}

async function loadDrafts() {
  const data = await api("/api/drafts");
  state.drafts.sections = new Set((data.drafts || []).map(item => sectionKey(item.bookId, item.sectionIndex)));
  state.drafts.exports = new Set((data.exports || []).map(item => item.bookId));
  el.draftSummary.textContent = `${state.drafts.sections.size} saved section drafts / ${state.drafts.exports.size} exported books`;
}

function filteredBooks() {
  const query = el.searchInput.value.trim().toLowerCase();
  const filter = el.statusFilter.value;
  return state.books.filter(book => {
    if (query && !`${book.title} ${book.id}`.toLowerCase().includes(query)) return false;
    if (filter === "gold") return book.status === "Gold sample";
    if (filter === "rough") return book.status !== "Gold sample";
    if (filter === "heavy") return book.status === "Heavy pass";
    if (filter === "medium") return book.status === "Medium pass";
    if (filter === "light") return book.status === "Light pass";
    return true;
  });
}

function renderBooks() {
  const books = filteredBooks();
  el.bookList.innerHTML = "";
  el.selectedCount.textContent = `${state.selectedBooks.size} selected`;
  books.forEach(book => {
    const row = document.createElement("div");
    row.className = `bookRow ${book.id === state.selectedBookId ? "active" : ""}`;
    const statusClass = book.status === "Gold sample" ? "gold" : book.status === "Heavy pass" ? "heavy" : "";
    row.innerHTML = `
      <input type="checkbox" aria-label="Select ${book.title}" ${state.selectedBooks.has(book.id) ? "checked" : ""} />
      <div class="bookRowBody">
        <strong>${book.title}</strong>
        <div class="bookMeta">
          <span class="pill ${statusClass}">${book.status}</span>
          <span class="pill">${book.emDash} dashes</span>
          <span class="pill">score ${book.score}</span>
          <span class="pill">${book.wordCount.toLocaleString()} words</span>
        </div>
      </div>
    `;
    row.querySelector("input").addEventListener("change", event => {
      if (event.currentTarget.checked) state.selectedBooks.add(book.id);
      else state.selectedBooks.delete(book.id);
      el.selectedCount.textContent = `${state.selectedBooks.size} selected`;
    });
    row.querySelector(".bookRowBody").addEventListener("click", () => loadBook(book.id));
    el.bookList.appendChild(row);
  });
}

function renderBook() {
  if (!state.book) return;
  const summary = state.books.find(book => book.id === state.selectedBookId);
  el.bookKicker.textContent = `${state.selectedBookId} / ${summary?.status || "Book"}`;
  el.bookTitle.textContent = state.book.title || state.selectedBookId;
  el.bookStats.innerHTML = [
    `${summary?.emDash ?? 0} em dashes`,
    `score ${summary?.score ?? 0}`,
    `${summary?.wordCount ?? 0} words`,
    `${state.book.sections?.length || 0} sections`,
  ].map(item => `<span class="pill">${item}</span>`).join("");

  el.sectionSelect.innerHTML = "";
  (state.book.sections || []).forEach((section, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${index + 1}. ${section.title || section.id || "Untitled"} (${words(sectionText(section))} words)`;
    el.sectionSelect.appendChild(option);
  });
  el.sectionSelect.value = String(state.selectedSectionIndex);
  renderSection();
}

function renderSection() {
  const section = state.book?.sections?.[state.selectedSectionIndex];
  const text = sectionText(section);
  const html = sectionHtml(section);
  const residue = residueFor(text);
  setOriginalHtml(html);
  el.originalMeta.textContent = section ? `${section.title || section.id} / ${words(text)} words / ${residue.emDash} dashes / score ${residue.score}` : "";
  const accepted = state.accepted.get(state.selectedSectionIndex);
  const acceptedText = draftText(accepted);
  setCleanHtml(acceptedText);
  setSourceMode(false);
  if (accepted) {
    const cleanResidue = residueFor(plainText(acceptedText));
    el.cleanMeta.textContent = `Accepted draft loaded / ${cleanResidue.emDash} dashes / score ${cleanResidue.score}`;
  } else {
    el.cleanMeta.textContent = "AI output lands here.";
  }
}

async function loadConfig() {
  state.config = await api("/api/config");
  const parts = [];
  if (state.config.hasAnthropic) parts.push("Anthropic ready");
  if (state.config.hasOpenAI) parts.push("OpenAI ready");
  el.providerStatus.textContent = parts.length ? parts.join(" / ") : "No AI key found";
  el.providerSelect.value = state.config.defaultProvider;
  el.modelInput.value = state.config.defaultProvider === "openai" ? state.config.openaiModel : state.config.anthropicModel;
}

async function loadBooks() {
  const data = await api("/api/books");
  state.books = data.books || [];
  el.auditSource.textContent = data.auditSource || "";
  renderBooks();
  updateEstimate();
  if (!state.selectedBookId && state.books[0]) await loadBook(state.books[0].id);
}

async function loadStyleGuide() {
  const data = await api("/api/style-guide");
  el.styleGuide.value = data.text || "";
}

async function loadBook(id) {
  state.selectedBookId = id;
  state.selectedSectionIndex = 0;
  state.accepted = new Map();
  state.book = await api(`/api/book/${encodeURIComponent(id)}`);
  renderBooks();
  renderBook();
}

async function cleanCurrent() {
  if (!state.book) return;
  const text = el.originalText.value.trim();
  if (!text) return;
  el.cleanBtn.disabled = true;
  el.cleanMeta.textContent = "Cleaning...";
  notice("Calling AI cleanup. Do not navigate away from this section.");
  try {
    const data = await api("/api/clean", {
      method: "POST",
      body: JSON.stringify({
        provider: el.providerSelect.value,
        model: el.modelInput.value.trim(),
        text,
      }),
    });
    setCleanHtml(data.cleanedHtml || data.cleanedText || "");
    const cleanPlain = data.cleanedText || plainText(getCleanHtml());
    const cleanResidue = residueFor(cleanPlain);
    el.cleanMeta.textContent = `${words(cleanPlain)} words cleaned / ${data.chunks || 1} chunk(s) / ${cleanResidue.emDash} dashes / score ${cleanResidue.score}`;
    notice("AI cleanup complete. Review before accepting.");
  } catch (error) {
    notice(error.message);
    el.cleanMeta.textContent = "AI cleanup failed.";
  } finally {
    el.cleanBtn.disabled = false;
  }
}

async function cleanText(text) {
  const data = await api("/api/clean", {
    method: "POST",
    body: JSON.stringify({
      provider: el.providerSelect.value,
      model: el.modelInput.value.trim(),
      text,
    }),
  });
  return {
    cleanedHtml: data.cleanedHtml || data.cleanedText || "",
    cleanedText: data.cleanedText || plainText(data.cleanedHtml || ""),
    chunks: data.chunks || 1,
  };
}

async function runTest() {
  if (!state.book) return;
  setBatchDisabled(true);
  state.stopRequested = false;
  try {
    notice("Running test cleanup on the current section...");
    const result = await cleanText(el.originalText.value.trim());
    const cleaned = result.cleanedHtml;
    setCleanHtml(cleaned);
    const cleanResidue = residueFor(result.cleanedText);
    el.cleanMeta.textContent = `${words(result.cleanedText)} words cleaned / ${result.chunks} chunk(s) / ${cleanResidue.emDash} dashes / score ${cleanResidue.score}`;
    notice("Test cleanup complete. Nothing was saved automatically.");
  } catch (error) {
    notice(error.message);
  } finally {
    setBatchDisabled(false);
  }
}

async function runSelectedBook() {
  if (!state.book) return;
  setBatchDisabled(true);
  state.stopRequested = false;
  state.accepted = new Map();
  const sections = cleanupSections(state.book);
  try {
    for (let i = 0; i < sections.length; i += 1) {
      if (state.stopRequested) break;
      const item = sections[i];
      if (el.skipSavedInput.checked && state.drafts.sections.has(sectionKey(state.selectedBookId, item.index))) {
        notice(`Skipping saved section ${i + 1}/${sections.length}`);
        continue;
      }
      state.selectedSectionIndex = item.index;
      el.sectionSelect.value = String(item.index);
      renderSection();
      notice(`Cleaning ${state.book.title || state.selectedBookId}: ${i + 1}/${sections.length}`);
      const result = await cleanText(item.html);
      const draft = { cleanedHtml: result.cleanedHtml, cleanedText: result.cleanedText };
      state.accepted.set(item.index, draft);
      setCleanHtml(draft.cleanedHtml);
      const cleanResidue = residueFor(draft.cleanedText);
      el.cleanMeta.textContent = `Accepted automatically / ${result.chunks} chunk(s) / ${cleanResidue.emDash} dashes / score ${cleanResidue.score}`;
      await api("/api/save-draft", {
        method: "POST",
        body: JSON.stringify({
          bookId: state.selectedBookId,
          sectionIndex: item.index,
          ...draft,
        }),
      });
      state.drafts.sections.add(sectionKey(state.selectedBookId, item.index));
      await sleep(250);
    }
    if (!state.stopRequested && state.accepted.size) await exportBook();
    await loadDrafts();
    notice(state.stopRequested ? "Stopped selected book run." : "Selected book run complete.");
  } catch (error) {
    notice(error.message);
  } finally {
    setBatchDisabled(false);
  }
}

function sweepOrder() {
  const rough = state.books.filter(book => book.status !== "Gold sample");
  const gold = state.books.filter(book => book.status === "Gold sample");
  return [...rough, ...gold];
}

function scopeBooks(scope) {
  const byWorst = [...state.books].sort((a, b) => b.emDash - a.emDash || b.score - a.score || a.wordCount - b.wordCount);
  if (scope === "book") return state.selectedBookId ? state.books.filter(book => book.id === state.selectedBookId) : [];
  if (scope === "selected") return state.books.filter(book => state.selectedBooks.has(book.id));
  if (scope === "nonGold") return state.books.filter(book => book.status !== "Gold sample");
  if (scope === "over10") return state.books.filter(book => Number(book.emDash || 0) > 10);
  if (scope === "worst5") return byWorst.slice(0, 5);
  if (scope === "worst10") return byWorst.slice(0, 10);
  if (scope === "all") return sweepOrder();
  return [];
}

async function runBookQueue(queue, label = "batch") {
  if (!queue.length) return notice("No books matched that scope.");
  setBatchDisabled(true);
  state.stopRequested = false;
  try {
    for (let bookIndex = 0; bookIndex < queue.length; bookIndex += 1) {
      if (state.stopRequested) break;
      const book = queue[bookIndex];
      if (el.skipSavedInput.checked && state.drafts.exports.has(book.id)) {
        notice(`Skipping exported book ${bookIndex + 1}/${queue.length}: ${book.title}`);
        continue;
      }
      await loadBook(book.id);
      state.accepted = new Map();
      const sections = cleanupSections(state.book);
      for (let sectionPos = 0; sectionPos < sections.length; sectionPos += 1) {
        if (state.stopRequested) break;
        const item = sections[sectionPos];
        if (el.skipSavedInput.checked && state.drafts.sections.has(sectionKey(book.id, item.index))) {
          notice(`Skipping saved ${book.title} / section ${sectionPos + 1}/${sections.length}`);
          continue;
        }
        state.selectedSectionIndex = item.index;
        el.sectionSelect.value = String(item.index);
        renderSection();
        notice(`Sweep ${bookIndex + 1}/${queue.length}: ${book.title} / section ${sectionPos + 1}/${sections.length}`);
        const result = await cleanText(item.html);
        const draft = { cleanedHtml: result.cleanedHtml, cleanedText: result.cleanedText };
        state.accepted.set(item.index, draft);
        setCleanHtml(draft.cleanedHtml);
        const cleanResidue = residueFor(draft.cleanedText);
        el.cleanMeta.textContent = `Accepted automatically / ${result.chunks} chunk(s) / ${cleanResidue.emDash} dashes / score ${cleanResidue.score}`;
        await api("/api/save-draft", {
          method: "POST",
          body: JSON.stringify({
            bookId: book.id,
            sectionIndex: item.index,
            ...draft,
          }),
        });
        state.drafts.sections.add(sectionKey(book.id, item.index));
        await sleep(250);
      }
      if (!state.stopRequested && state.accepted.size) await exportBook();
      if (!state.stopRequested && state.accepted.size) state.drafts.exports.add(book.id);
      el.draftSummary.textContent = `${state.drafts.sections.size} saved section drafts / ${state.drafts.exports.size} exported books`;
    }
    notice(state.stopRequested ? `${label} stopped.` : `${label} complete.`);
  } catch (error) {
    notice(error.message);
  } finally {
    setBatchDisabled(false);
  }
}

async function runFullSweep() {
  const ok = window.confirm("Run the full sweep across every book? This can take a long time and spend real API money. Non-Gold books run first, Gold samples last.");
  if (!ok) return;
  await runBookQueue(sweepOrder(), "Full sweep");
}

async function runScope() {
  const scope = el.scopeSelect.value;
  if (scope === "chapter") return runTest();
  if (scope === "book") return runSelectedBook();

  const queue = scopeBooks(scope);
  const label = el.scopeSelect.options[el.scopeSelect.selectedIndex]?.textContent || "Selected scope";
  const ok = window.confirm(`Run ${label} across ${queue.length} book(s)? This can take a long time and spend real API money.`);
  if (!ok) return;
  return runBookQueue(queue, label);
}

function acceptCurrent() {
  if (!state.book) return;
  const draft = draftFromHtml(getCleanHtml());
  if (!draft.cleanedHtml) return notice("No cleaned draft to accept.");
  state.accepted.set(state.selectedSectionIndex, draft);
  el.cleanMeta.textContent = "Accepted in this session.";
  notice(`Accepted section ${state.selectedSectionIndex + 1}.`);
}

function rejectCurrent() {
  state.accepted.delete(state.selectedSectionIndex);
  setCleanHtml("");
  el.cleanMeta.textContent = "Rejected.";
  notice(`Rejected section ${state.selectedSectionIndex + 1}.`);
}

async function saveDraft() {
  if (!state.book) return;
  const draft = draftFromHtml(getCleanHtml());
  if (!draft.cleanedHtml) return notice("No cleaned draft to save.");
  const data = await api("/api/save-draft", {
    method: "POST",
    body: JSON.stringify({
      bookId: state.selectedBookId,
      sectionIndex: state.selectedSectionIndex,
      ...draft,
    }),
  });
  state.accepted.set(state.selectedSectionIndex, draft);
  state.drafts.sections.add(sectionKey(state.selectedBookId, state.selectedSectionIndex));
  el.draftSummary.textContent = `${state.drafts.sections.size} saved section drafts / ${state.drafts.exports.size} exported books`;
  notice(`Saved draft: ${data.file}`);
}

async function exportBook() {
  if (!state.book) return;
  const drafts = collectExportDrafts();
  const data = await api("/api/export-book", {
    method: "POST",
    body: JSON.stringify({ bookId: state.selectedBookId, drafts }),
  });
  state.drafts.exports.add(state.selectedBookId);
  el.draftSummary.textContent = `${state.drafts.sections.size} saved section drafts / ${state.drafts.exports.size} exported books`;
  notice(`Exported fixed JSON copy: ${data.file} (${data.updatedSections || drafts.length} section(s)).`);
}

function collectExportDrafts() {
  const currentDraft = draftFromHtml(getCleanHtml());
  if (currentDraft.cleanedHtml) {
    state.accepted.set(state.selectedSectionIndex, currentDraft);
  }
  return [...state.accepted.entries()].map(([sectionIndex, draft]) => ({
    sectionIndex,
    ...draftFromHtml(draftText(draft)),
  }));
}

async function applyLiveBook() {
  if (!state.book) return;
  const ok = window.confirm(`Update the live private/book-content JSON for "${state.book.title || state.selectedBookId}"? A backup will be saved first.`);
  if (!ok) return;

  const drafts = collectExportDrafts();
  const data = await api("/api/apply-book", {
    method: "POST",
    body: JSON.stringify({ bookId: state.selectedBookId, drafts }),
  });
  state.drafts.exports.add(state.selectedBookId);
  await loadBook(state.selectedBookId);
  await loadDrafts();
  notice(`Updated live JSON: ${data.file}. Backup: ${data.backup}. ${data.updatedSections || drafts.length} section(s) applied.`);
}

async function saveGuide() {
  await api("/api/write-style-guide", {
    method: "POST",
    body: JSON.stringify({ text: el.styleGuide.value }),
  });
  notice("Style guide saved.");
}

async function saveApiToken() {
  const token = el.apiTokenInput.value.trim();
  if (!token) return notice("Paste an API token first.");

  el.saveTokenBtn.disabled = true;
  try {
    await api("/api/save-api-key", {
      method: "POST",
      body: JSON.stringify({
        provider: el.providerSelect.value,
        token,
        model: el.modelInput.value.trim(),
      }),
    });
    el.apiTokenInput.value = "";
    await loadConfig();
    notice(`${el.providerSelect.value === "openai" ? "OpenAI" : "Anthropic"} token saved to .env.local. AI cleanup is ready.`);
  } catch (error) {
    notice(error.message);
  } finally {
    el.saveTokenBtn.disabled = false;
  }
}

function selectVisibleBooks() {
  filteredBooks().forEach(book => state.selectedBooks.add(book.id));
  renderBooks();
  notice(`${state.selectedBooks.size} book(s) selected.`);
}

function clearSelectedBooks() {
  state.selectedBooks.clear();
  renderBooks();
  notice("Selection cleared.");
}

el.refreshBtn.addEventListener("click", () => init());
el.searchInput.addEventListener("input", renderBooks);
el.statusFilter.addEventListener("change", renderBooks);
el.providerSelect.addEventListener("change", () => {
  if (!state.config) return;
  el.modelInput.value = el.providerSelect.value === "openai" ? state.config.openaiModel : state.config.anthropicModel;
});
el.sectionSelect.addEventListener("change", () => {
  state.selectedSectionIndex = Number(el.sectionSelect.value);
  renderSection();
});
el.cleanBtn.addEventListener("click", cleanCurrent);
el.testBtn.addEventListener("click", runTest);
el.runBookBtn.addEventListener("click", runSelectedBook);
el.runAllBtn.addEventListener("click", runFullSweep);
el.runScopeBtn.addEventListener("click", runScope);
el.stopBtn.addEventListener("click", () => {
  state.stopRequested = true;
  notice("Stop requested. Current AI call will finish, then the batch will pause.");
});
el.acceptBtn.addEventListener("click", acceptCurrent);
el.rejectBtn.addEventListener("click", rejectCurrent);
el.saveBtn.addEventListener("click", saveDraft);
el.exportBtn.addEventListener("click", exportBook);
el.applyLiveBtn.addEventListener("click", applyLiveBook);
el.saveGuideBtn.addEventListener("click", saveGuide);
el.saveTokenBtn.addEventListener("click", saveApiToken);
el.selectVisibleBtn.addEventListener("click", selectVisibleBooks);
el.clearSelectedBtn.addEventListener("click", clearSelectedBooks);
el.cleanEditor.addEventListener("input", syncCleanSource);
el.blockPBtn.addEventListener("click", () => runEditorCommand("formatBlock", "p"));
el.blockH2Btn.addEventListener("click", () => runEditorCommand("formatBlock", "h2"));
el.blockH3Btn.addEventListener("click", () => runEditorCommand("formatBlock", "h3"));
el.italicBtn.addEventListener("click", () => runEditorCommand("italic"));
el.quoteBtn.addEventListener("click", () => runEditorCommand("formatBlock", "blockquote"));
el.sourceToggleBtn.addEventListener("click", () => setSourceMode(!sourceMode));

async function init() {
  try {
    notice("Loading Gold Cleaner...");
    await Promise.all([loadConfig(), loadStyleGuide()]);
    await loadDrafts();
    await loadBooks();
    el.stopBtn.disabled = true;
    notice(`Loaded ${state.books.length} books.`);
  } catch (error) {
    notice(error.message);
  }
}

void init();
