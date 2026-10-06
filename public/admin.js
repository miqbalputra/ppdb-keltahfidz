(() => {
  const loginCard = document.querySelector("#login-card");
  const dashboard = document.querySelector("#dashboard");
  const loginForm = document.querySelector("#login-form");
  const loginAlert = document.querySelector("#login-alert");
  const dashboardAlert = document.querySelector("#dashboard-alert");
  const settingsAlert = document.querySelector("#settings-alert");
  const rowsContainer = document.querySelector("#waitinglist-rows");
  const filterForm = document.querySelector("#filter-form");
  const settingsForm = document.querySelector("#settings-form");
  const brochureForm = document.querySelector("#brochure-form");
  const brochureAlert = document.querySelector("#brochure-alert");
  const brochureFile = document.querySelector("#brochure-file");
  const brochureSave = document.querySelector("#brochure-save");
  const brochureDelete = document.querySelector("#brochure-delete");
  let csrfToken = "";
  let currentPage = 1;
  let totalPages = 1;
  let rowsRequestController = null;

  function showAlert(element, message, type = "error") {
    element.textContent = message;
    element.className = `form-alert ${type}`;
    element.hidden = !message;
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    if (csrfToken && options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrfToken;
    let response;
    try {
      response = await fetch(path, { ...options, headers });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new Error("Koneksi bermasalah. Periksa jaringan lalu coba lagi.");
    }
    const contentType = response.headers.get("Content-Type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : null;
    if (response.status === 401 && !path.includes("/api/admin/login")) {
      csrfToken = "";
      dashboard.hidden = true;
      loginCard.hidden = false;
      showAlert(loginAlert, "Sesi admin berakhir. Silakan masuk kembali.");
      loginCard.querySelector("h1").focus();
    }
    if (!response.ok) throw new Error(payload?.error || "Permintaan tidak berhasil.");
    return payload;
  }

  function showDashboard(focusHeading = false) {
    loginCard.hidden = true;
    dashboard.hidden = false;
    if (focusHeading) dashboard.querySelector(".dashboard-heading h1").focus();
    loadSystem();
    loadBrochure();
    loadRows();
  }

  async function restoreSession() {
    try {
      const result = await api("/api/admin/me");
      if (result.authenticated) {
        csrfToken = result.csrfToken;
        showDashboard();
      }
    } catch (error) {
      showAlert(loginAlert, error.message);
    }
  }

  function formatDate(value, includeTime = false) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const options = includeTime
      ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short", year: "numeric" };
    return new Intl.DateTimeFormat("id-ID", { ...options, timeZone: "Asia/Jakarta" }).format(date);
  }

  function setSystemStatus(elementId, healthy, label) {
    const element = document.querySelector(elementId);
    element.textContent = label;
    element.classList.toggle("is-ok", healthy);
    element.classList.toggle("is-down", !healthy);
  }

  function applySettings(settings) {
    if (!settings) return;
    settingsForm.elements.cutoffDate.value = settings.cutoffDate;
    settingsForm.elements.minAgeYears.value = settings.minAgeYears;
    settingsForm.elements.minAgeMonths.value = settings.minAgeMonths;
    settingsForm.elements.whatsappGroupUrl.value = settings.whatsappGroupUrl || "";
    settingsForm.elements.openingCountdownEnabled.checked = settings.openingCountdownEnabled === true;
    settingsForm.elements.openingDateTime.value = settings.openingDateTime || "";
  }

  async function loadSystem() {
    try {
      const result = await api("/api/admin/system");
      setSystemStatus("#system-app-status", result.app.status === "online", result.app.status === "online" ? "Berjalan" : "Tidak aktif");
      setSystemStatus("#system-db-status", result.database.status === "online", result.database.status === "online" ? "Terhubung" : "Terputus");
      setSystemStatus("#system-n8n-status", result.integrations.n8nConfigured, result.integrations.n8nConfigured ? "Dikonfigurasi" : "Belum diatur");
      setSystemStatus("#system-turnstile-status", result.integrations.turnstileEnabled, result.integrations.turnstileEnabled ? "Aktif" : "Nonaktif");
      document.querySelector("#system-runtime").textContent = `${result.app.runtime} · aktif ${Math.floor(result.app.uptimeSeconds / 60)} menit`;
      document.querySelector("#system-n8n-detail").textContent = result.integrations.n8nConfigured ? "Webhook diatur di environment Coolify" : "Atur URL webhook melalui environment Coolify";
      const databaseReady = result.database.status === "online";
      document.querySelector("#stat-total").textContent = databaseReady ? result.metrics.total : "—";
      document.querySelector("#stat-eligible").textContent = databaseReady ? result.metrics.eligible : "—";
      document.querySelector("#stat-recent").textContent = databaseReady ? result.metrics.last24Hours : "—";
      applySettings(result.settings);
      document.querySelector("#settings-updated").textContent = result.settingsUpdatedAt
        ? `Terakhir diubah ${formatDate(result.settingsUpdatedAt, true)}`
        : "Belum pernah diubah";
    } catch (error) {
      showAlert(dashboardAlert, error.message);
      setSystemStatus("#system-app-status", false, "Tidak dapat diperiksa");
      setSystemStatus("#system-db-status", false, "Tidak dapat diperiksa");
    }
  }

  async function loadBrochure() {
    try {
      const current = await api("/api/admin/brochure");
      document.querySelector("#brochure-current").textContent = current.available
        ? `Brosur tersedia · ${(current.size / (1024 * 1024)).toFixed(2)} MB · diperbarui ${formatDate(current.updatedAt, true)} WIB`
        : "Belum ada brosur. Tombol publik akan menampilkan pesan 'Brosur belum tersedia'.";
      document.querySelector("#brochure-preview").hidden = !current.available;
      brochureDelete.disabled = !current.available;
    } catch (error) {
      showAlert(brochureAlert, error.message);
    }
  }

  function makeCell(text, className = "") {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = text || "—";
    return cell;
  }

  function renderRows(rows) {
    rowsContainer.replaceChildren();
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "table-empty";
      td.textContent = "Belum ada data yang cocok dengan pencarian.";
      tr.append(td);
      rowsContainer.append(tr);
      return;
    }
    for (const item of rows) {
      const tr = document.createElement("tr");
      const child = document.createElement("td");
      child.className = "person-cell";
      const childName = document.createElement("strong");
      childName.textContent = item.nama_anak;
      childName.title = item.nama_anak;
      const childDetail = document.createElement("small");
      const genderLabel = item.jenis_kelamin === "putra"
        ? "Putra"
        : item.jenis_kelamin === "putri" ? "Putri" : "Jenis kelamin belum dicatat";
      childDetail.textContent = [
        genderLabel,
        item.sekolah_asal ? `Sekolah: ${item.sekolah_asal}` : "",
        `${item.umur_terhitung_bulan} bulan · snapshot saat daftar`,
      ].filter(Boolean).join(" · ");
      child.append(childName, childDetail);
      const feeAccepted = Number(item.konfirmasi_ketentuan_biaya) === 1;
      if (feeAccepted) {
        const feeConsent = document.createElement("small");
        feeConsent.className = "fee-consent-status accepted";
        feeConsent.textContent = "Ketentuan biaya: disetujui";
        child.append(feeConsent);
      }
      if (item.bukti_transfer_mime) {
        const proofLink = document.createElement("a");
        proofLink.href = `/api/admin/waitinglist/${encodeURIComponent(item.id)}/proof`;
        proofLink.textContent = "Unduh bukti transfer";
        proofLink.className = "proof-download-link";
        proofLink.setAttribute("aria-label", `Unduh bukti transfer ${item.nama_anak}`);
        child.append(proofLink);
      }
      const exportActions = document.createElement("div");
      exportActions.className = "individual-export-actions";
      for (const [format, label] of [["pdf", "PDF"], ["xlsx", "Excel"]]) {
        const link = document.createElement("a");
        link.href = `/api/admin/waitinglist/${encodeURIComponent(item.id)}/export.${format}`;
        link.className = "individual-export-link";
        link.textContent = label;
        link.setAttribute("aria-label", `Ekspor data ${item.nama_anak} sebagai ${format === "pdf" ? "PDF" : "Excel"}`);
        exportActions.append(link);
      }
      child.append(exportActions);
      tr.append(child);

      const parent = document.createElement("td");
      parent.className = "person-cell";
      const parentName = document.createElement("strong");
      parentName.textContent = item.nama_ortu;
      parentName.title = item.nama_ortu;
      const parentDetail = document.createElement("small");
      parentDetail.textContent = item.status_ortu === "bapak" ? "Bapak" : "Ibu";
      parent.append(parentName, parentDetail);
      tr.append(parent);

      tr.append(makeCell(formatDate(item.tanggal_lahir_anak)));
      const address = document.createElement("td");
      address.className = "address-cell";
      address.textContent = `${item.desa_nama}, ${item.kecamatan_nama}`;
      address.title = address.textContent;
      tr.append(address);
      const contact = document.createElement("td");
      contact.className = "person-cell contact-cell";
      const phone = document.createElement("a");
      phone.href = `https://wa.me/${encodeURIComponent(item.no_hp_wa)}`;
      phone.target = "_blank";
      phone.rel = "noopener noreferrer";
      phone.textContent = item.no_hp_wa;
      phone.title = `Buka WhatsApp untuk ${item.no_hp_wa}`;
      const email = document.createElement("small");
      email.textContent = item.email;
      email.title = item.email;
      contact.append(phone, email);
      tr.append(contact);
      const statusCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `status-badge ${item.status_eligibility}`;
      badge.textContent = item.status_eligibility === "eligible" ? "Memenuhi" : "Belum memenuhi";
      statusCell.append(badge);
      tr.append(statusCell, makeCell(formatDate(item.created_at, true)));
      rowsContainer.append(tr);
    }
  }

  let appliedFilters = new URLSearchParams();

  function filtersFromForm() {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(filterForm)) {
      const normalized = String(value).trim();
      if (normalized && normalized !== "all") params.set(key, normalized);
    }
    return params;
  }

  function filtersQuery(page) {
    const params = new URLSearchParams(appliedFilters);
    if (page !== undefined) params.set("page", String(page));
    return params.toString();
  }

  async function loadRows() {
    rowsRequestController?.abort();
    const controller = new AbortController();
    rowsRequestController = controller;
    showAlert(dashboardAlert, "");
    document.querySelector(".table-scroll").setAttribute("aria-busy", "true");
    renderTableMessage("Memuat data pendaftar…");
    try {
      const result = await api(`/api/admin/waitinglist?${filtersQuery(currentPage)}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      renderRows(result.rows);
      totalPages = result.pages;
      document.querySelector("#table-summary").textContent = `${result.total} pendaftar · halaman ${result.page} dari ${result.pages}`;
      document.querySelector("#page-indicator").textContent = `${result.page} / ${result.pages}`;
      document.querySelector("#previous-page").disabled = result.page <= 1;
      document.querySelector("#next-page").disabled = result.page >= result.pages;
    } catch (error) {
      if (controller.signal.aborted) return;
      renderTableMessage("Data tidak dapat dimuat. Periksa koneksi lalu coba muat ulang.");
      showAlert(dashboardAlert, error.message);
    } finally {
      if (rowsRequestController === controller) {
        rowsRequestController = null;
        document.querySelector(".table-scroll").removeAttribute("aria-busy");
      }
    }
  }

  function renderTableMessage(message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "table-empty";
    cell.textContent = message;
    row.append(cell);
    rowsContainer.replaceChildren(row);
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAlert(loginAlert, "");
    const loginButton = loginForm.querySelector('button[type="submit"]');
    loginButton.disabled = true;
    loginForm.setAttribute("aria-busy", "true");
    loginButton.querySelector("span:first-child").textContent = "Memeriksa…";
    const data = new FormData(loginForm);
    try {
      const result = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
      });
      csrfToken = result.csrfToken;
      loginForm.reset();
      showDashboard(true);
    } catch (error) {
      showAlert(loginAlert, error.message);
    } finally {
      loginButton.disabled = false;
      loginForm.removeAttribute("aria-busy");
      loginButton.querySelector("span:first-child").textContent = "Masuk dashboard";
    }
  });

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    currentPage = 1;
    appliedFilters = filtersFromForm();
    loadRows();
  });

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAlert(settingsAlert, "");
    const saveButton = document.querySelector("#save-settings");
    saveButton.disabled = true;
    settingsForm.setAttribute("aria-busy", "true");
    saveButton.textContent = "Menyimpan…";
    const formData = new FormData(settingsForm);
    try {
      await api("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          cutoffDate: formData.get("cutoffDate"),
          minAgeYears: Number(formData.get("minAgeYears")),
          minAgeMonths: Number(formData.get("minAgeMonths")),
          whatsappGroupUrl: formData.get("whatsappGroupUrl"),
          openingCountdownEnabled: formData.get("openingCountdownEnabled") === "on",
          openingDateTime: formData.get("openingDateTime"),
        }),
      });
      showAlert(settingsAlert, "Pengaturan berhasil disimpan.", "success");
      await loadSystem();
      await loadRows();
    } catch (error) {
      showAlert(settingsAlert, error.message);
    } finally {
      saveButton.disabled = false;
      settingsForm.removeAttribute("aria-busy");
      saveButton.textContent = "Simpan pengaturan";
    }
  });

  brochureForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAlert(brochureAlert, "");
    const file = brochureFile.files?.[0];
    if (!file || file.size > 10 * 1024 * 1024) {
      showAlert(brochureAlert, "Pilih brosur PDF dengan ukuran maksimal 10 MB.");
      return;
    }
    brochureSave.disabled = true;
    brochureForm.setAttribute("aria-busy", "true");
    try {
      const data = new FormData();
      data.append("brochure", file);
      await api("/api/admin/brochure", { method: "POST", body: data });
      brochureForm.reset();
      await loadBrochure();
      showAlert(brochureAlert, "Brosur berhasil diunggah dan siap diunduh.", "success");
    } catch (error) {
      showAlert(brochureAlert, error.message);
    } finally {
      brochureSave.disabled = false;
      brochureForm.removeAttribute("aria-busy");
    }
  });

  brochureDelete.addEventListener("click", async () => {
    if (!window.confirm("Hapus brosur SPSB yang sedang tampil?")) return;
    showAlert(brochureAlert, "");
    brochureDelete.disabled = true;
    try {
      await api("/api/admin/brochure", { method: "DELETE" });
      await loadBrochure();
      showAlert(brochureAlert, "Brosur berhasil dihapus.", "success");
    } catch (error) {
      showAlert(brochureAlert, error.message);
      await loadBrochure();
    }
  });

  document.querySelector("#refresh-system").addEventListener("click", () => {
    loadSystem();
    loadBrochure();
    loadRows();
  });

  document.querySelector("#previous-page").addEventListener("click", () => {
    if (currentPage > 1) { currentPage -= 1; loadRows(); }
  });
  document.querySelector("#next-page").addEventListener("click", () => {
    if (currentPage < totalPages) { currentPage += 1; loadRows(); }
  });
  document.querySelector("#export-xlsx-button").addEventListener("click", () => {
    window.location.assign(`/api/admin/export.xlsx?${filtersQuery()}`);
  });
  document.querySelector("#export-button").addEventListener("click", () => {
    window.location.assign(`/api/admin/export.csv?${filtersQuery()}`);
  });
  document.querySelector("#logout-button").addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", { method: "POST", body: "{}" });
      csrfToken = "";
      dashboard.hidden = true;
      loginCard.hidden = false;
      loginCard.querySelector("h1").focus();
    } catch (error) {
      showAlert(dashboardAlert, error.message || "Sesi belum dapat diakhiri. Coba lagi.");
    }
  });

  restoreSession();
})();
