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
  let reportRequestId = 0;
  let currentView = "active";
  let currentParticipantId = "";
  let settingsDirty = false;
  const settingsUpdated = document.querySelector("#settings-updated");
  const participantDialog = document.querySelector("#participant-dialog");

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
    loadReport();
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

  function applySettings(settings, force = false) {
    if (!settings || (settingsDirty && !force)) return;
    settingsForm.elements.cutoffDate.value = settings.cutoffDate;
    settingsForm.elements.minAgeYears.value = settings.minAgeYears;
    settingsForm.elements.minAgeMonths.value = settings.minAgeMonths;
    settingsForm.elements.whatsappGroupUrl.value = settings.whatsappGroupUrl || "";
    settingsForm.elements.openingCountdownEnabled.checked = settings.openingCountdownEnabled === true;
    settingsForm.elements.openingDateTime.value = settings.openingDateTime || "";
    settingsDirty = false;
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
      if (settingsDirty) {
        settingsUpdated.textContent = "Perubahan lokal belum disimpan · formulir dipertahankan";
      } else {
        applySettings(result.settings);
        settingsUpdated.textContent = result.settingsUpdatedAt
          ? `Terakhir diubah ${formatDate(result.settingsUpdatedAt, true)}`
          : "Belum pernah diubah";
      }
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

  function formatAge(months) {
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    return remainingMonths ? `${years} tahun ${remainingMonths} bulan` : `${years} tahun`;
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
        `${formatAge(item.umur_terhitung_bulan)} · saat mendaftar`,
        item.deleted_at ? `Diarsipkan ${formatDate(item.deleted_at, true)}` : "",
      ].filter(Boolean).join(" · ");
      child.append(childName, childDetail);
      const feeAccepted = Number(item.konfirmasi_ketentuan_biaya) === 1;
      if (feeAccepted) {
        const feeConsent = document.createElement("small");
        feeConsent.className = "fee-consent-status accepted";
        feeConsent.textContent = "Ketentuan biaya: disetujui";
        child.append(feeConsent);
      }
      if (item.has_proof) {
        const proofStatus = document.createElement("small");
        proofStatus.className = "proof-download-link";
        proofStatus.textContent = "Bukti transfer terlampir";
        child.append(proofStatus);
      }
      if (currentView === "active") {
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
      }
      const detailButton = document.createElement("button");
      detailButton.type = "button";
      detailButton.className = "participant-detail-button";
      detailButton.textContent = "Lihat detail";
      detailButton.setAttribute("aria-label", `Lihat detail pendaftaran ${item.nama_anak}`);
      detailButton.addEventListener("click", () => showParticipantDetail(item.id));
      child.append(detailButton);
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

      tr.append(makeCell(`${formatAge(item.umur_terhitung_bulan)} · saat mendaftar`));
      const address = document.createElement("td");
      address.className = "address-cell";
      address.textContent = `${item.desa_nama}, ${item.kecamatan_nama}`;
      address.title = address.textContent;
      tr.append(address);
      const contact = document.createElement("td");
      contact.className = "person-cell contact-cell";
      const contactLabel = document.createElement("span");
      contactLabel.textContent = "Lihat di detail";
      contact.append(contactLabel);
      tr.append(contact);
      const statusCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `status-badge ${item.status_eligibility}`;
      badge.textContent = item.status_eligibility === "eligible" ? "Memenuhi saat daftar" : "Belum memenuhi saat daftar";
      statusCell.append(badge);
      tr.append(statusCell, makeCell(formatDate(item.created_at, true)));
      rowsContainer.append(tr);
    }
  }

  let appliedFilters = new URLSearchParams();

  function filtersFromForm() {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(filterForm)) {
      if (key === "view") continue;
      const normalized = String(value).trim();
      if (normalized && normalized !== "all") params.set(key, normalized);
    }
    return params;
  }

  function filtersQuery(page, includeView = false) {
    const params = new URLSearchParams(appliedFilters);
    if (includeView) params.set("view", currentView);
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
      const result = await api(`/api/admin/waitinglist?${filtersQuery(currentPage, true)}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      renderRows(result.rows);
      totalPages = result.pages;
      document.querySelector("#table-summary").textContent = `${new Intl.NumberFormat("id-ID").format(result.total)} pendaftar ${currentView === "archived" ? "diarsipkan" : "aktif"} · halaman ${result.page} dari ${result.pages}`;
      document.querySelector("#export-xlsx-button").hidden = currentView === "archived";
      document.querySelector("#export-button").hidden = currentView === "archived";
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

  async function loadReport() {
    const requestId = ++reportRequestId;
    const reportPeriod = document.querySelector("#report-period-label");
    reportPeriod.textContent = "Memuat laporan…";
    try {
      const report = await api(`/api/admin/report?${filtersQuery()}`);
      if (requestId !== reportRequestId) return;
      const number = (value) => new Intl.NumberFormat("id-ID").format(value);
      document.querySelector("#report-total").textContent = number(report.total);
      document.querySelector("#report-putra").textContent = number(report.gender.putra);
      document.querySelector("#report-putri").textContent = number(report.gender.putri);
      document.querySelector("#report-gender-unrecorded").textContent = `Belum dicatat: ${number(report.gender.unrecorded)}`;
      document.querySelector("#report-eligible").textContent = number(report.eligibilityAtSubmission.eligible);
      document.querySelector("#report-not-eligible").textContent = `Belum memenuhi: ${number(report.eligibilityAtSubmission.notEligible)} · Belum tercatat: ${number(report.eligibilityAtSubmission.unrecorded)}`;
      const activeFilters = new URLSearchParams(appliedFilters).size;
      reportPeriod.textContent = report.registrationPeriod.label === "Semua pendaftar"
        ? `Semua tanggal pendaftaran · ${activeFilters ? "sesuai filter aktif" : "semua pendaftar"} · tren 30 hari terakhir`
        : `Periode pendaftaran: ${report.registrationPeriod.label}`;
      document.querySelector("#report-filter-status").textContent = currentView === "archived"
        ? "Laporan dan ekspor hanya mencakup pendaftar aktif; arsip tidak dihitung."
        : activeFilters
          ? `${activeFilters} filter aktif · laporan, tabel, dan ekspor memakai cakupan yang sama.`
          : "Tanpa filter · ringkasan mencakup semua pendaftar.";
      const firstTrendDate = report.daily[0]?.date;
      const lastTrendDate = report.daily.at(-1)?.date;
      document.querySelector("#report-trend-period").textContent = report.registrationPeriod.label === "Semua pendaftar"
        ? "30 hari terakhir"
        : firstTrendDate && lastTrendDate ? `${formatDate(firstTrendDate)} – ${formatDate(lastTrendDate)}` : "Tidak ada tanggal pada filter";
      renderDailyReport(report.daily);
      renderAreaReport(report.topDistricts);
    } catch (error) {
      if (requestId !== reportRequestId) return;
      reportPeriod.textContent = "Laporan belum dapat dimuat.";
      showAlert(dashboardAlert, error.message);
      ["#report-total", "#report-putra", "#report-putri", "#report-eligible", "#report-gender-unrecorded", "#report-not-eligible"]
        .forEach((selector) => { document.querySelector(selector).textContent = "—"; });
      document.querySelector("#report-filter-status").textContent = "Data laporan tidak tersedia.";
      document.querySelector("#report-trend-period").textContent = "—";
      renderDailyReport([]);
      renderAreaReport([]);
    }
  }

  function renderDailyReport(days) {
    const chart = document.querySelector("#daily-report");
    chart.replaceChildren();
    const max = Math.max(1, ...days.map((day) => day.total));
    for (const day of days) {
      const item = document.createElement("li");
      item.title = `${formatDate(day.date)}: ${day.total} pendaftar`;
      item.setAttribute("aria-label", `${formatDate(day.date)}: ${day.total} pendaftar`);
      const bar = document.createElement("span");
      bar.className = "daily-report-bar";
      bar.style.height = `${Math.max(day.total ? 8 : 2, Math.round(day.total / max * 100))}%`;
      const label = document.createElement("small");
      label.textContent = day.date.slice(8, 10);
      item.append(bar, label);
      chart.append(item);
    }
  }

  function renderAreaReport(areas) {
    const list = document.querySelector("#area-report");
    list.replaceChildren();
    if (!areas.length) {
      const empty = document.createElement("li");
      empty.textContent = "Belum ada data wilayah.";
      list.append(empty);
      return;
    }
    for (const area of areas) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = `${area.district}, ${area.regency}, ${area.province}`;
      const total = document.createElement("strong");
      total.textContent = new Intl.NumberFormat("id-ID").format(area.total);
      item.append(name, total);
      list.append(item);
    }
  }

  async function showParticipantDetail(id) {
    currentParticipantId = id;
    participantDialog.showModal();
    document.querySelector("#participant-detail-status").hidden = false;
    document.querySelector("#participant-detail-status").textContent = "Memuat detail pendaftaran…";
    document.querySelector("#participant-detail-grid").hidden = true;
    document.querySelector("#participant-detail-actions").hidden = true;
    try {
      const participant = await api(`/api/admin/waitinglist/${encodeURIComponent(id)}`);
      const setDetail = (selector, value) => { document.querySelector(selector).textContent = value || "Belum dicatat"; };
      const isArchived = Boolean(participant.deleted_at);
      document.querySelector("#archive-participant-button").hidden = isArchived;
      document.querySelector("#restore-participant-button").hidden = !isArchived;
      document.querySelector("#detail-pdf-link").hidden = isArchived;
      document.querySelector("#detail-xlsx-link").hidden = isArchived;
      if (isArchived) {
        setDetail("#participant-detail-status", `Diarsipkan ${formatDate(participant.deleted_at, true)} oleh ${participant.deleted_by || "admin"}. Data masih tersimpan dan dapat dipulihkan.`);
        document.querySelector("#participant-detail-status").hidden = false;
      }
      document.querySelector("#participant-dialog-title").textContent = participant.nama_anak;
      setDetail("#detail-child", participant.nama_anak);
      setDetail("#detail-gender", participant.jenis_kelamin === "putra" ? "Putra" : participant.jenis_kelamin === "putri" ? "Putri" : "Belum dicatat");
      setDetail("#detail-school", participant.sekolah_asal);
      setDetail("#detail-birthdate", formatDate(participant.tanggal_lahir_anak));
      setDetail("#detail-age", `${formatAge(participant.umur_terhitung_bulan)} (${participant.umur_terhitung_bulan} bulan)`);
      setDetail("#detail-eligibility", participant.status_eligibility === "eligible" ? "Memenuhi kriteria saat mendaftar" : "Belum memenuhi kriteria saat mendaftar");
      setDetail("#detail-parent", `${participant.nama_ortu} · ${participant.status_ortu === "bapak" ? "Bapak" : "Ibu"}`);
      setDetail("#detail-phone", participant.no_hp_wa);
      setDetail("#detail-email", participant.email);
      setDetail("#detail-address", [participant.desa_nama, participant.kecamatan_nama, participant.kabupaten_nama, participant.provinsi_nama].filter(Boolean).join(", "));
      setDetail("#detail-data-consent", Number(participant.konfirmasi_data) === 1 ? "Disetujui" : "Belum dicatat");
      setDetail("#detail-transfer-consent", Number(participant.konfirmasi_bukti_transfer) === 1 ? "Dikonfirmasi saat mendaftar · bukan verifikasi pembayaran panitia" : "Belum dikonfirmasi");
      setDetail("#detail-fee-consent", Number(participant.konfirmasi_ketentuan_biaya) === 1 ? "Disetujui" : "Belum dicatat");
      setDetail("#detail-created", formatDate(participant.created_at, true));
      const proof = document.querySelector("#detail-proof-link");
      proof.hidden = !participant.has_proof;
      proof.href = `/api/admin/waitinglist/${encodeURIComponent(id)}/proof`;
      document.querySelector("#detail-pdf-link").href = `/api/admin/waitinglist/${encodeURIComponent(id)}/export.pdf`;
      document.querySelector("#detail-xlsx-link").href = `/api/admin/waitinglist/${encodeURIComponent(id)}/export.xlsx`;
      if (!isArchived) document.querySelector("#participant-detail-status").hidden = true;
      document.querySelector("#participant-detail-grid").hidden = false;
      document.querySelector("#participant-detail-actions").hidden = false;
    } catch (error) {
      document.querySelector("#participant-detail-status").textContent = error.message;
    }
  }

  async function changeParticipantLifecycle(action) {
    if (!currentParticipantId) return;
    const archive = action === "archive";
    const message = archive
      ? "Pindahkan pendaftar ini ke arsip? Data dan bukti transfer tidak dihapus dan dapat dipulihkan kapan saja."
      : "Pulihkan pendaftar ini ke daftar aktif?";
    if (!window.confirm(message)) return;
    const button = document.querySelector(archive ? "#archive-participant-button" : "#restore-participant-button");
    button.disabled = true;
    try {
      await api(`/api/admin/waitinglist/${encodeURIComponent(currentParticipantId)}/${action}`, { method: "POST", body: "{}" });
      participantDialog.close();
      if (!archive) {
        currentView = "active";
        document.querySelector("#participant-view").value = "active";
      }
      currentPage = 1;
      await loadRows();
      await loadReport();
      showAlert(dashboardAlert, archive ? "Pendaftar dipindahkan ke arsip dan dapat dipulihkan." : "Pendaftar berhasil dipulihkan.", "success");
    } catch (error) {
      showAlert(dashboardAlert, error.message);
    } finally {
      button.disabled = false;
    }
  }

  document.querySelector("#archive-participant-button").addEventListener("click", () => changeParticipantLifecycle("archive"));
  document.querySelector("#restore-participant-button").addEventListener("click", () => changeParticipantLifecycle("restore"));
  document.querySelector("#close-participant-dialog").addEventListener("click", () => participantDialog.close());
  participantDialog.addEventListener("click", (event) => {
    if (event.target === participantDialog) participantDialog.close();
  });

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

  settingsForm.addEventListener("input", () => {
    settingsDirty = true;
    settingsUpdated.textContent = "Perubahan lokal belum disimpan";
  });
  settingsForm.addEventListener("change", () => {
    settingsDirty = true;
    settingsUpdated.textContent = "Perubahan lokal belum disimpan";
  });

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    currentPage = 1;
    currentView = String(new FormData(filterForm).get("view") || "active");
    appliedFilters = filtersFromForm();
    loadRows();
    loadReport();
  });

  document.querySelector("#filter-reset").addEventListener("click", () => {
    filterForm.reset();
    currentPage = 1;
    currentView = "active";
    appliedFilters = new URLSearchParams();
    loadRows();
    loadReport();
  });

  document.querySelector("#refresh-report").addEventListener("click", loadReport);

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAlert(settingsAlert, "");
    const saveButton = document.querySelector("#save-settings");
    saveButton.disabled = true;
    settingsForm.setAttribute("aria-busy", "true");
    saveButton.textContent = "Menyimpan…";
    const formData = new FormData(settingsForm);
    try {
      const saved = await api("/api/admin/settings", {
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
      settingsDirty = false;
      applySettings(saved.settings, true);
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
    const isImage = file && (["image/jpeg", "image/png"].includes(file.type) || /\.(jpe?g|png)$/i.test(file.name));
    if (!file || !isImage || file.size > 10 * 1024 * 1024) {
      showAlert(brochureAlert, "Pilih brosur JPG atau PNG dengan ukuran maksimal 10 MB.");
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
    loadReport();
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
