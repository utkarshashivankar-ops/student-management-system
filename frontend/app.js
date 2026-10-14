(() => {
  "use strict";

  const API = (window.APP_CONFIG && window.APP_CONFIG.API_URL || "").replace(/\/$/, "");
  const BASE = API + "/api/students";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- helpers ---------- */
  function toast(message, type = "success") {
    const el = $("#toast");
    el.textContent = message;
    el.className = "toast show " + type;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.className = "toast"), 3200);
  }

  async function request(url, options = {}, timeoutMs = 60000) {
    // Render's free tier can take ~50s to wake up, so the timeout is generous.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        signal: ctrl.signal
      });
      let body = {};
      try { body = await res.json(); } catch (_) { /* non-JSON response */ }
      if (!res.ok) throw new Error(body.message || `Request failed (${res.status})`);
      return body;
    } catch (err) {
      if (err.name === "AbortError") throw new Error("The server took too long to respond. Try again in a moment.");
      if (err instanceof TypeError) throw new Error("Cannot reach the server. Check your internet connection and the API URL in config.js.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  const text = (v) => (v === undefined || v === null || v === "" ? "–" : String(v));

  function setBusy(btn, busy, busyLabel) {
    if (busy) { btn.dataset.label = btn.textContent; btn.textContent = busyLabel; }
    else if (btn.dataset.label) { btn.textContent = btn.dataset.label; }
    btn.disabled = busy;
  }

  /* ---------- navigation ---------- */
  function show(view) {
    $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === "view-" + view));
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
    if (view === "home") loadStats();
    if (view === "list") loadList();
    if (view === "search") $("#searchInput").focus();
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));
  $$("[data-go]").forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));

  /* ---------- server status ---------- */
  async function checkServer() {
    const dot = $("#statusDot"), label = $("#statusText");
    dot.className = "dot"; label.textContent = "Waking up server…";
    try {
      const r = await request(API + "/api/health", {}, 70000);
      dot.className = "dot ok";
      label.textContent = r.success ? "Server and database online" : "Server online";
    } catch (e) {
      dot.className = "dot bad";
      label.textContent = "Server unreachable";
    }
  }

  /* ---------- table rendering ---------- */
  function renderTable(container, students, emptyMessage) {
    container.replaceChildren();
    if (!students.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = emptyMessage;
      container.appendChild(p);
      return;
    }
    const table = document.createElement("table");
    const thead = table.createTHead().insertRow();
    ["Student ID", "Name", "Email", "Department", "Semester", "Contact", ""].forEach((h) => {
      const th = document.createElement("th");
      th.textContent = h;
      if (!h) th.setAttribute("aria-label", "Actions");
      thead.appendChild(th);
    });
    const tbody = table.createTBody();
    students.forEach((s) => {
      const tr = tbody.insertRow();
      const idCell = tr.insertCell(); idCell.className = "id"; idCell.textContent = s.studentId;
      tr.insertCell().textContent = s.name;
      tr.insertCell().textContent = s.email;
      tr.insertCell().textContent = s.department;
      const semCell = tr.insertCell();
      const badge = document.createElement("span"); badge.className = "sem"; badge.textContent = "Sem " + s.semester;
      semCell.appendChild(badge);
      tr.insertCell().textContent = text(s.contact);

      const act = tr.insertCell(); act.className = "actions";
      const edit = document.createElement("button");
      edit.className = "btn small"; edit.textContent = "Edit"; edit.setAttribute("aria-label", "Edit " + s.name);
      edit.addEventListener("click", () => openEdit(s.studentId, edit));
      const del = document.createElement("button");
      del.className = "btn small danger-outline"; del.textContent = "Delete"; del.setAttribute("aria-label", "Delete " + s.name);
      del.addEventListener("click", () => openDelete(s));
      act.append(edit, del);
    });
    container.appendChild(table);
  }

  function showLoading(container, msg) {
    container.innerHTML = "";
    const p = document.createElement("p"); p.className = "loading"; p.textContent = msg;
    container.appendChild(p);
  }
  function showError(container, msg, retry) {
    container.innerHTML = "";
    const box = document.createElement("div"); box.className = "error-box";
    const p = document.createElement("p"); p.textContent = msg;
    const b = document.createElement("button"); b.className = "btn"; b.textContent = "Try again";
    b.addEventListener("click", retry);
    box.append(p, b); container.appendChild(box);
  }

  /* ---------- READ: list ---------- */
  async function loadList() {
    const wrap = $("#listWrap");
    showLoading(wrap, "Loading students… (the first load can take up to a minute while the server wakes up)");
    try {
      const r = await request(BASE);
      renderTable(wrap, r.data, "No students yet. Use “Add student” to create the first record.");
    } catch (e) {
      showError(wrap, e.message, loadList);
    }
  }
  $("#refreshBtn").addEventListener("click", loadList);

  /* ---------- READ: home stats ---------- */
  async function loadStats() {
    try {
      const r = await request(BASE);
      const list = r.data;
      $("#statTotal").textContent = list.length;
      $("#statDepts").textContent = new Set(list.map((s) => s.department.toLowerCase())).size;
      $("#statLatest").textContent = list.length ? list[0].name : "–";
    } catch (_) { /* status badge already shows connectivity problems */ }
  }

  /* ---------- READ: search ---------- */
  async function runSearch(term) {
    const wrap = $("#searchWrap");
    if (!term) {
      wrap.innerHTML = "";
      const p = document.createElement("p"); p.className = "empty";
      p.textContent = "Type a name, ID, email or department to find students.";
      wrap.appendChild(p);
      return;
    }
    showLoading(wrap, "Searching…");
    try {
      const r = await request(BASE + "?search=" + encodeURIComponent(term));
      renderTable(wrap, r.data, `No students match “${term}”.`);
    } catch (e) {
      showError(wrap, e.message, () => runSearch(term));
    }
  }
  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch($("#searchInput").value.trim());
  });

  /* ---------- form helpers ---------- */
  function formData(form) {
    const d = {};
    new FormData(form).forEach((v, k) => (d[k] = typeof v === "string" ? v.trim() : v));
    if (d.semester) d.semester = Number(d.semester);
    return d;
  }

  function validate(form, data, includeId) {
    $$(".invalid", form).forEach((el) => el.classList.remove("invalid"));
    const errors = [];
    const mark = (name, msg) => { const el = form.elements[name]; if (el) el.classList.add("invalid"); errors.push(msg); };

    if (includeId && !/^[A-Za-z0-9-]{2,20}$/.test(data.studentId || "")) mark("studentId", "Student ID must be 2–20 letters, digits or hyphens.");
    if (!data.name || data.name.length < 2) mark("name", "Enter the student's full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email || "")) mark("email", "Enter a valid email address.");
    if (!data.department) mark("department", "Enter a department.");
    if (!(data.semester >= 1 && data.semester <= 8)) mark("semester", "Choose a semester from 1 to 8.");
    if (data.contact && !/^\d{10}$/.test(data.contact)) mark("contact", "Contact number must be exactly 10 digits.");
    return errors;
  }

  /* ---------- CREATE ---------- */
  $("#addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target, err = $("#addError"), btn = $("#addSubmit");
    const data = formData(form);
    const errors = validate(form, data, true);
    err.textContent = errors[0] || "";
    if (errors.length) return;

    setBusy(btn, true, "Adding…");
    try {
      const r = await request(BASE, { method: "POST", body: JSON.stringify(data) });
      toast(r.message || "Student added successfully");
      form.reset();
      show("list");
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      setBusy(btn, false);
    }
  });
  $("#addForm").addEventListener("reset", () => {
    $("#addError").textContent = "";
    $$(".invalid", $("#addForm")).forEach((el) => el.classList.remove("invalid"));
  });

  /* ---------- UPDATE ---------- */
  const editDialog = $("#editDialog");
  let editingId = null;

  async function openEdit(studentId, trigger) {
    trigger.disabled = true;
    try {
      const r = await request(BASE + "/" + encodeURIComponent(studentId)); // GET /api/students/:id
      const s = r.data, form = $("#editForm");
      editingId = s.studentId;
      form.elements.studentId.value = s.studentId;
      form.elements.name.value = s.name;
      form.elements.email.value = s.email;
      form.elements.department.value = s.department;
      form.elements.semester.value = String(s.semester);
      form.elements.contact.value = s.contact || "";
      $("#editSub").textContent = "Changes are saved to the database when you select Save changes.";
      $("#editError").textContent = "";
      $$(".invalid", form).forEach((el) => el.classList.remove("invalid"));
      editDialog.showModal();
    } catch (ex) {
      toast(ex.message, "error");
    } finally {
      trigger.disabled = false;
    }
  }

  $("#editCancel").addEventListener("click", () => editDialog.close());
  $("#editForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target, err = $("#editError"), btn = $("#editSubmit");
    const data = formData(form);
    delete data.studentId; // disabled field, and the ID cannot be changed
    const errors = validate(form, data, false);
    err.textContent = errors[0] || "";
    if (errors.length) return;

    setBusy(btn, true, "Saving…");
    try {
      const r = await request(BASE + "/" + encodeURIComponent(editingId), { method: "PUT", body: JSON.stringify(data) });
      editDialog.close();
      toast(r.message || "Student updated successfully");
      refreshVisibleTables();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      setBusy(btn, false);
    }
  });

  /* ---------- DELETE ---------- */
  const deleteDialog = $("#deleteDialog");
  let deletingId = null;

  function openDelete(s) {
    deletingId = s.studentId;
    $("#deleteText").textContent = `${s.name} (${s.studentId}) will be permanently removed from the database.`;
    deleteDialog.showModal();
  }
  $("#deleteCancel").addEventListener("click", () => deleteDialog.close());
  $("#deleteConfirm").addEventListener("click", async () => {
    const btn = $("#deleteConfirm");
    setBusy(btn, true, "Deleting…");
    try {
      const r = await request(BASE + "/" + encodeURIComponent(deletingId), { method: "DELETE" });
      deleteDialog.close();
      toast(r.message || "Student deleted successfully");
      refreshVisibleTables();
    } catch (ex) {
      deleteDialog.close();
      toast(ex.message, "error");
    } finally {
      setBusy(btn, false);
    }
  });

  function refreshVisibleTables() {
    if ($("#view-list").classList.contains("is-active")) loadList();
    if ($("#view-search").classList.contains("is-active")) runSearch($("#searchInput").value.trim());
  }

  /* ---------- start ---------- */
  checkServer();
  loadStats();
})();
