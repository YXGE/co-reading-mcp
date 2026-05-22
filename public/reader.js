const state = {
  books: [],
  chunks: [],
  annotations: [],
  bookId: null,
  chunkId: null,
  chunk: null,
  quote: "",
  selectedQuote: "",
  activeAnnotationId: null,
  refreshInFlight: false,
};

const $ = (id) => document.getElementById(id);
const authTokenKey = "co-reading-auth-token";
const urlToken = new URLSearchParams(location.search).get("token");
if (urlToken) {
  localStorage.setItem(authTokenKey, urlToken);
  history.replaceState(null, "", location.pathname);
}

async function api(path, options = {}) {
  const token = localStorage.getItem(authTokenKey);
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result);
      let binary = "";
      const size = 0x8000;
      for (let index = 0; index < bytes.length; index += size) {
        binary += String.fromCharCode(...bytes.subarray(index, index + size));
      }
      resolve(btoa(binary));
    };
    reader.readAsArrayBuffer(file);
  });
}

function renderBooks() {
  $("books").innerHTML = state.books
    .map((book) => {
      const total = book.chunkCount || 0;
      const read = book.chunksRead || 0;
      const pct = total ? Math.round((read / total) * 100) : 0;
      return `<button class="book ${book.bookId === state.bookId ? "active" : ""}" data-book="${escapeHtml(book.bookId)}">
        <span class="book-title">${escapeHtml(book.title || book.bookId)}</span>
        <span class="book-meta">${escapeHtml(book.author || "Unknown author")} · ${read}/${total} · ${book.annotationCount || 0} notes</span>
        <span class="progress"><span style="width: ${pct}%"></span></span>
      </button>`;
    })
    .join("");
}

function renderChunks() {
  $("chunks").innerHTML = state.chunks
    .map(
      (chunk) => `<button class="chunk ${chunk.id === state.chunkId ? "active" : ""}" data-chunk="${escapeHtml(chunk.id)}">
        <span class="chunk-title">${escapeHtml(chunk.title)}</span>
        <span class="chunk-meta">${escapeHtml(chunk.id)} · ${chunk.read ? "read" : "unread"} · ${chunk.annotationCount || 0} notes</span>
      </button>`,
    )
    .join("");
}

function renderText() {
  if (!state.chunk) return;
  let html = escapeHtml(state.chunk.text);
  for (const note of state.annotations.filter((item) => item.chunkId === state.chunkId && !item.parentId && item.quote)) {
    const quote = escapeHtml(note.quote);
    if (quote && html.includes(quote)) {
      html = html.replace(
        quote,
        `<mark class="${note.id === state.activeAnnotationId ? "active" : ""}" data-note-id="${escapeHtml(note.id)}" title="${escapeHtml(note.note)}">${quote}</mark>`,
      );
    }
  }
  $("text").innerHTML = html;
}

function renderAnnotations() {
  const notes = state.annotations.filter((item) => item.chunkId === state.chunkId);
  const roots = notes.filter((item) => !item.parentId);
  const openCount = state.annotations.filter((item) => item.author === "user" && (item.status || "open") === "open")
    .length;

  $("margins").innerHTML = roots
    .map((note) => {
      const replies = notes.filter((item) => item.parentId === note.id);
      const expanded = note.id === state.activeAnnotationId;
      return `<article class="note-card ${(note.status || "") === "open" ? "open" : ""} ${expanded ? "active" : ""}" data-note-id="${escapeHtml(note.id)}" tabindex="0">
        <p class="note-quote">${escapeHtml(note.quote)}</p>
        <p class="note-body">${escapeHtml(note.note)}</p>
        <div class="note-meta">${escapeHtml(note.author || "unknown")} · ${escapeHtml(note.kind || "note")} · ${escapeHtml(note.status || "published")}${replies.length ? ` · ${replies.length} replies` : ""}</div>
        ${
          expanded
            ? `<div class="thread">
                ${replies
                  .map(
                    (reply) => `<div class="reply ${reply.author === "user" ? "user" : ""}">
                      <p class="reply-body">${escapeHtml(reply.note)}</p>
                      <div class="note-meta">${escapeHtml(reply.author || "unknown")} · ${escapeHtml(reply.kind || "reply")}</div>
                    </div>`,
                  )
                  .join("")}
                <form class="reply-form" data-parent-id="${escapeHtml(note.id)}">
                  <textarea rows="2" placeholder="Reply in this margin..."></textarea>
                  <button type="submit" class="primary-button">Reply</button>
                </form>
              </div>`
            : ""
        }
      </article>`;
    })
    .join("");

  $("submit-notes").disabled = openCount === 0;
  $("submit-notes").textContent = openCount ? `Send ${openCount} to Claude` : "Send to Claude";
  $("status").textContent = openCount
    ? `${openCount} open note${openCount === 1 ? "" : "s"} waiting.`
    : "Open notes stay local until you send them.";
}

function updateSelectionAction() {
  const selection = window.getSelection();
  const quote = selection?.toString().trim() || "";
  state.selectedQuote = quote;
  $("note-selection").disabled = !quote || !state.bookId || !state.chunkId;
}

async function loadBooks() {
  state.books = await api("/api/books");
  renderBooks();
}

async function selectBook(bookId) {
  state.bookId = bookId;
  state.chunkId = null;
  state.chunk = null;
  state.activeAnnotationId = null;
  state.chunks = await api(`/api/books/${encodeURIComponent(bookId)}/chunks`);
  state.annotations = await api(`/api/annotations?bookId=${encodeURIComponent(bookId)}`);
  const book = state.books.find((item) => item.bookId === bookId);
  $("book-meta").textContent = book?.author || "Unknown author";
  $("book-title").textContent = book?.title || bookId;
  $("chunk-file").textContent = "No chapter selected";
  $("chunk-title").textContent = "Open a chapter to start reading";
  $("text").innerHTML = `<p class="empty">Choose a chapter. Highlight text to leave a note for Claude.</p>`;
  $("mark-read").disabled = true;
  renderBooks();
  renderChunks();
  renderAnnotations();
}

async function selectChunk(chunkId) {
  state.chunkId = chunkId;
  state.activeAnnotationId = null;
  state.chunk = await api(`/api/books/${encodeURIComponent(state.bookId)}/chunks/${encodeURIComponent(chunkId)}`);
  $("chunk-file").textContent = state.chunk.chunk.id;
  $("chunk-title").textContent = state.chunk.chunk.title;
  $("mark-read").disabled = false;
  renderChunks();
  renderText();
  renderAnnotations();
}

function openNoteForm(quote) {
  state.quote = quote.trim();
  if (!state.bookId || !state.chunkId || !state.quote) return;
  $("quote-preview").textContent = state.quote;
  $("note").value = "";
  $("note-form").hidden = false;
  $("note").focus();
}

function activateAnnotation(noteId, { scroll = false } = {}) {
  state.activeAnnotationId = noteId;
  renderText();
  renderAnnotations();
  if (scroll) {
    document.querySelector(`.note-card[data-note-id="${CSS.escape(noteId)}"]`)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }
}

async function refreshCurrent() {
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;
  try {
    await loadBooks();
    if (state.bookId) {
      state.chunks = await api(`/api/books/${encodeURIComponent(state.bookId)}/chunks`);
      state.annotations = await api(`/api/annotations?bookId=${encodeURIComponent(state.bookId)}`);
      renderBooks();
      renderChunks();
      renderText();
      renderAnnotations();
    }
  } finally {
    state.refreshInFlight = false;
  }
}

$("books").addEventListener("click", (event) => {
  const button = event.target.closest("[data-book]");
  if (button) selectBook(button.dataset.book).catch(showError);
});

$("chunks").addEventListener("click", (event) => {
  const button = event.target.closest("[data-chunk]");
  if (button) selectChunk(button.dataset.chunk).catch(showError);
});

$("text").addEventListener("mouseup", () => {
  updateSelectionAction();
});

$("text").addEventListener("touchend", () => {
  setTimeout(updateSelectionAction, 80);
});

$("text").addEventListener("click", (event) => {
  const mark = event.target.closest("mark[data-note-id]");
  if (mark) activateAnnotation(mark.dataset.noteId, { scroll: true });
});

document.addEventListener("selectionchange", updateSelectionAction);

$("cancel-note").addEventListener("click", () => {
  $("note-form").hidden = true;
});

$("note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/annotations", {
    method: "POST",
    body: {
      bookId: state.bookId,
      chunkId: state.chunkId,
      quote: state.quote,
      note: $("note").value.trim(),
      kind: "note",
    },
  });
  $("note-form").hidden = true;
  window.getSelection()?.removeAllRanges();
  updateSelectionAction();
  await refreshCurrent();
});

$("note-selection").addEventListener("click", () => {
  const quote = state.selectedQuote || window.getSelection()?.toString() || "";
  openNoteForm(quote);
});

$("margins").addEventListener("click", (event) => {
  if (event.target.closest("textarea, button")) return;
  const card = event.target.closest(".note-card[data-note-id]");
  if (card) activateAnnotation(card.dataset.noteId);
});

$("margins").addEventListener("submit", async (event) => {
  const form = event.target.closest(".reply-form");
  if (!form) return;
  event.preventDefault();
  const textarea = form.querySelector("textarea");
  const note = textarea.value.trim();
  if (!note) return;
  await api("/api/replies", {
    method: "POST",
    body: {
      parentId: form.dataset.parentId,
      note,
      author: "user",
      kind: "reply",
    },
  });
  textarea.value = "";
  await refreshCurrent();
});

$("submit-notes").addEventListener("click", async () => {
  await api("/api/submit-notes", {
    method: "POST",
    body: {
      bookId: state.bookId,
      sessionId: "reader",
      contextMode: "chunk-once-per-session",
    },
  });
  await refreshCurrent();
});

$("mark-read").addEventListener("click", async () => {
  await api("/api/mark-read", {
    method: "POST",
    body: { bookId: state.bookId, chunkId: state.chunkId },
  });
  await refreshCurrent();
});

$("refresh").addEventListener("click", () => refreshCurrent().catch(showError));

$("import-book").addEventListener("click", () => {
  $("import-file").click();
});

$("import-file").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  $("import-book").disabled = true;
  try {
    for (const file of files) {
      $("status").textContent = `Importing ${file.name}...`;
      await api("/api/import", {
        method: "POST",
        body: {
          filename: file.name,
          dataBase64: await fileToBase64(file),
        },
      });
    }
    $("status").textContent = files.length === 1 ? `Imported ${files[0].name}.` : `Imported ${files.length} books.`;
    await loadBooks();
    renderBooks();
  } catch (error) {
    showError(error);
  } finally {
    $("import-book").disabled = false;
    event.target.value = "";
  }
});

function showError(error) {
  $("status").textContent = error.message || String(error);
}

loadBooks().catch(showError);
setInterval(() => {
  if (document.hidden) return;
  refreshCurrent().catch(showError);
}, 5000);
