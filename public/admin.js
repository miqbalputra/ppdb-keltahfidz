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
  let reportRequestController = null;
  let participantRequestId = 0;
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
    if (response.status === 401 && !path.includes('/api/admin/login')) expireSession();
    if (!response.ok) throw new Error(payload?.error || "Permintaan tidak berhasil.");
    return payload;
  }

  function showDashboard(focusHeading = false) {
    loginCard.hidden = true;
    dashboard.hidden = false;
    if (focusHeading) dashboard.querySelector(".dashboard-heading h1").focus();
    loadRows();
    loadReport();
    loadFilterOptions();
    navigate(false);
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
    if (months === null || !Number.isFinite(Number(months)) || Number(months) < 0) return 'Belum tercatat';
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
        `ID: ${item.id}`,
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
      parentDetail.textContent = item.status_ortu === "bapak" ? "Bapak" : item.status_ortu === 'ibu' ? "Ibu" : item.status_ortu || 'Belum tercatat';
      parent.append(parentName, parentDetail);
      tr.append(parent);

      tr.append(makeCell(`${formatAge(item.umur_terhitung_bulan)} · saat mendaftar`));
      const address = document.createElement("td");
      address.className = "address-cell";
      address.textContent = [item.desa_nama, item.kecamatan_nama, item.kabupaten_nama, item.provinsi_nama].filter(Boolean).join(', ');
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
      badge.textContent = item.status_eligibility === "eligible" ? "Memenuhi saat daftar" : item.status_eligibility === 'not_eligible' ? "Belum memenuhi saat daftar" : 'Belum tercatat';
      statusCell.append(badge);
      tr.append(statusCell, makeCell(formatDate(item.created_at, true)));
      rowsContainer.append(tr);
    }
  }

  let appliedFilters = new URLSearchParams();

  function filtersFromForm() {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(filterForm)) {
      if (key === 'view' || (key === 'sort' && value === 'newest') || (key === 'page_size' && value === '25') || (key === 'trend' && value === 'auto')) continue;
      const normalized = String(value).trim();
      if (normalized && normalized !== "all") params.set(key, normalized);
    }
    return params;
  }

  function filtersQuery(page, includeView = true) {
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
      currentPage = result.page;
      document.querySelector("#table-summary").textContent = `${new Intl.NumberFormat("id-ID").format(result.total)} pendaftar ${currentView === "archived" ? "diarsipkan" : "aktif"} · halaman ${result.page} dari ${result.pages}`;
      document.querySelector("#export-xlsx-button").hidden = false;
      document.querySelector("#export-button").hidden = false;
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
    reportRequestController?.abort();
    const controller = new AbortController();
    reportRequestController = controller;
    const reportPanel = document.querySelector("#reports-panel");
    const reportPeriod = document.querySelector("#report-period-label");
    reportPanel.setAttribute("aria-busy", "true");
    reportPeriod.textContent = 'Memuat laporan…';
    document.querySelector('#analytics-panel').setAttribute('aria-busy', 'true');
    document.querySelector('#analytics-filters').textContent = '';
    document.querySelector('#scope-label').textContent = currentView === 'archived' ? 'DATA ARSIP' : 'DATA AKTIF';
    document.querySelector('#report-filter-status').textContent = 'Memuat cakupan filter terapan…';
    ["#report-total", "#report-putra", "#report-putri", "#report-eligible", "#report-gender-unrecorded", "#report-not-eligible"]
      .forEach((selector) => { document.querySelector(selector).textContent = "Memuat…"; });
    renderDailyReport([]);
    renderAreaReport([]);
    document.querySelector('#analytics-content').replaceChildren();
    document.querySelector('#recent-stats').replaceChildren();
    document.querySelector('#analytics-meta').textContent = 'Memuat laporan…';
    document.querySelector('#export-report').disabled = true;
    document.querySelector('#print-report').disabled = true;
    renderFilterChips();
    try {
      const report = await api(`/api/admin/report?${filtersQuery()}`, { signal: controller.signal });
      if (requestId !== reportRequestId) return;
      const number = (value) => new Intl.NumberFormat("id-ID").format(value);
      document.querySelector("#report-total").textContent = number(report.total);
      document.querySelector("#report-putra").textContent = number(report.gender.putra);
      document.querySelector("#report-putri").textContent = number(report.gender.putri);
      document.querySelector("#report-gender-unrecorded").textContent = `Belum dicatat: ${number(report.gender.unrecorded)}`;
      document.querySelector("#report-eligible").textContent = number(report.eligibilityAtSubmission.eligible);
      document.querySelector("#report-not-eligible").textContent = `Belum memenuhi: ${number(report.eligibilityAtSubmission.notEligible)} · Belum tercatat: ${number(report.eligibilityAtSubmission.unrecorded)}`;
      const activeFilters = [...appliedFilters.keys()].filter(key => !['sort', 'page_size', 'trend'].includes(key)).length;
      reportPeriod.textContent = report.registrationPeriod.label === "Semua pendaftar"
        ? `Semua tanggal pendaftaran · ${activeFilters ? "sesuai filter aktif" : "semua pendaftar"} · tren 30 hari terakhir`
        : `Periode pendaftaran: ${report.registrationPeriod.label}`;
      document.querySelector('#scope-label').textContent = currentView === 'archived' ? 'DATA ARSIP' : 'DATA AKTIF';
      document.querySelector('#report-filter-status').textContent = `${currentView === 'archived' ? 'Arsip' : 'Aktif'} · ${activeFilters} filter terapan · laporan, tabel, dan ekspor memakai cakupan yang sama.`;
      const firstTrendDate = report.daily[0]?.date;
      const lastTrendDate = report.daily.at(-1)?.date;
      document.querySelector("#report-trend-period").textContent = report.registrationPeriod.label === "Semua pendaftar"
        ? "30 hari terakhir"
        : firstTrendDate && lastTrendDate ? `${formatDate(firstTrendDate)} – ${formatDate(lastTrendDate)}` : "Tidak ada tanggal pada filter";
      if (report.trend) document.querySelector('#report-trend-period').textContent = `${report.trend.start} – ${report.trend.end} · ${report.trend.interval}`;
      renderDailyReport(report.trend?.buckets || report.daily);
      renderAreaReport(report.topDistricts);
      renderAnalytics(report);
      document.querySelector('#export-report').disabled = false;
      document.querySelector('#print-report').disabled = false;
    } catch (error) {
      if (controller.signal.aborted || requestId !== reportRequestId) return;
      reportPeriod.textContent = "Laporan belum dapat dimuat.";
      document.querySelector('#analytics-meta').textContent = 'Laporan gagal dimuat. Gunakan Muat ulang data untuk mencoba lagi.';
      showAlert(dashboardAlert, error.message);
      ["#report-total", "#report-putra", "#report-putri", "#report-eligible", "#report-gender-unrecorded", "#report-not-eligible"]
        .forEach((selector) => { document.querySelector(selector).textContent = "—"; });
      document.querySelector("#report-filter-status").textContent = "Data laporan tidak tersedia.";
      document.querySelector("#report-trend-period").textContent = "—";
      renderDailyReport([]);
      renderAreaReport([]);
    } finally {
      if (requestId === reportRequestId) { reportPanel.removeAttribute('aria-busy'); document.querySelector('#analytics-panel').removeAttribute('aria-busy'); }
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
      label.textContent = `${day.date.slice(8, 10)}/${day.date.slice(5, 7)} · ${day.total}`;
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
    const requestId = ++participantRequestId;
    currentParticipantId = id;
    participantDialog.showModal();
    participantDialog.setAttribute("aria-busy", "true");
    document.querySelector("#participant-detail-status").hidden = false;
    document.querySelector("#participant-detail-status").textContent = "Memuat detail pendaftaran…";
    document.querySelector("#participant-detail-grid").hidden = true;
    document.querySelector("#participant-detail-actions").hidden = true;
    try {
      const participant = await api(`/api/admin/waitinglist/${encodeURIComponent(id)}`);
      if (requestId !== participantRequestId || !participantDialog.open) return;
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
      setDetail('#detail-id', participant.id);
      addCopyButton('#detail-id', participant.id);
      setDetail('#detail-archive', isArchived ? `${formatDate(participant.deleted_at, true)} WIB · ${participant.deleted_by || 'admin'}` : 'Data aktif');
      setDetail("#detail-child", participant.nama_anak);
      setDetail("#detail-gender", participant.jenis_kelamin === "putra" ? "Putra" : participant.jenis_kelamin === "putri" ? "Putri" : "Belum dicatat");
      setDetail("#detail-school", participant.sekolah_asal);
      setDetail("#detail-birthdate", formatDate(participant.tanggal_lahir_anak));
      setDetail('#detail-age', participant.umur_terhitung_bulan === null ? 'Belum tercatat' : `${formatAge(participant.umur_terhitung_bulan)} (${participant.umur_terhitung_bulan} bulan)`);
      setDetail('#detail-eligibility', participant.status_eligibility === 'eligible' ? 'Memenuhi kriteria saat mendaftar' : participant.status_eligibility === 'not_eligible' ? 'Belum memenuhi kriteria saat mendaftar' : 'Belum tercatat');
      setDetail('#detail-parent', `${participant.nama_ortu} · ${participant.status_ortu === 'bapak' ? 'Bapak' : participant.status_ortu === 'ibu' ? 'Ibu' : participant.status_ortu || 'Belum tercatat'}`);
      setDetail("#detail-phone", participant.no_hp_wa);
      setDetail("#detail-email", participant.email);
      addContact('#detail-phone', participant.no_hp_wa, /^\+?[0-9]{8,16}$/.test(participant.no_hp_wa || '') ? `https://wa.me/${participant.no_hp_wa.replace(/^\+/, '')}` : null);
      addContact('#detail-email', participant.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(participant.email || '') ? `mailto:${encodeURIComponent(participant.email)}` : null);
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
      if (requestId === participantRequestId && participantDialog.open) {
        document.querySelector("#participant-detail-status").textContent = error.message;
      }
    } finally {
      if (requestId === participantRequestId) participantDialog.removeAttribute("aria-busy");
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
        window.location.hash = 'peserta';
      }
      loadFilterOptions();
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

  window.addEventListener("beforeunload", (event) => {
    if (!settingsDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  function validateDateRanges() {
    const ranges = [
      ["tanggal_daftar_mulai", "tanggal_daftar_sampai", "tanggal pendaftaran"],
      ["tanggal_lahir_mulai", "tanggal_lahir_sampai", "tanggal lahir"],
    ];
    let valid = true;
    for (const [startName, endName, label] of ranges) {
      const start = filterForm.elements[startName];
      const end = filterForm.elements[endName];
      const reversed = Boolean(start.value && end.value && start.value > end.value);
      end.setCustomValidity(reversed ? `Tanggal akhir ${label} harus sama atau setelah tanggal awal.` : "");
      if (reversed) { valid = false; const details = end.closest?.('details'); if (details) details.open = true; }
    }
    return valid;
  }

  filterForm.addEventListener("input", validateDateRanges);
  filterForm.addEventListener("change", validateDateRanges);
  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validateDateRanges()) {
      filterForm.reportValidity();
      return;
    }
    currentPage = 1;
    currentView = String(new FormData(filterForm).get("view") || "active");
    const changedScope = currentView !== lastOptionsView;
    appliedFilters = filtersFromForm();
    if (changedScope) loadFilterOptions();
    if (activePage === 'peserta' || activePage === 'arsip') {
      activePage = currentView === 'archived' ? 'arsip' : 'peserta';
      window.location.hash = activePage;
      navigate(false);
    }
    loadRows();
    loadReport();
  });

  document.querySelector("#filter-reset").addEventListener("click", () => {
    filterForm.reset();
    validateDateRanges();
    currentPage = 1;
    currentView = activePage === 'arsip' ? 'archived' : 'active';
    document.querySelector('#participant-view').value = currentView;
    appliedFilters = new URLSearchParams();
    loadFilterOptions();
    loadRows();
    loadReport();
  });

  document.querySelector("#refresh-report").addEventListener("click", loadReport);

  function settingsPayloadFromForm() {
    const formData = new FormData(settingsForm);
    return {
      cutoffDate: formData.get("cutoffDate"),
      minAgeYears: Number(formData.get("minAgeYears")),
      minAgeMonths: Number(formData.get("minAgeMonths")),
      whatsappGroupUrl: formData.get("whatsappGroupUrl"),
      openingCountdownEnabled: formData.get("openingCountdownEnabled") === "on",
      openingDateTime: formData.get("openingDateTime"),
    };
  }

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAlert(settingsAlert, "");
    const saveButton = document.querySelector("#save-settings");
    saveButton.disabled = true;
    settingsForm.setAttribute("aria-busy", "true");
    saveButton.textContent = "Menyimpan…";
    const submittedSettings = settingsPayloadFromForm();
    try {
      const saved = await api("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(submittedSettings),
      });
      const newerDraftExists = JSON.stringify(settingsPayloadFromForm()) !== JSON.stringify(submittedSettings);
      settingsDirty = newerDraftExists;
      if (newerDraftExists) {
        settingsUpdated.textContent = "Perubahan lokal belum disimpan";
        showAlert(settingsAlert, "Pengaturan yang dikirim tersimpan, tetapi perubahan yang dibuat setelahnya belum disimpan.", "success");
      } else {
        applySettings(saved.settings, true);
        showAlert(settingsAlert, "Pengaturan berhasil disimpan.", "success");
      }
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
  document.querySelector('#export-xlsx-button').addEventListener('click', event => download(`/api/admin/export.xlsx?${filtersQuery()}`, event.currentTarget));
  document.querySelector('#export-button').addEventListener('click', event => download(`/api/admin/export.csv?${filtersQuery()}`, event.currentTarget));
  document.querySelector('#export-report').addEventListener('click', event => download(`/api/admin/report.xlsx?${filtersQuery()}`, event.currentTarget));
  document.querySelector('#print-report').addEventListener('click', () => window.print());
  document.querySelector("#logout-button").addEventListener("click", async () => {
    if (settingsDirty && !window.confirm("Perubahan pengaturan belum disimpan. Tetap keluar dan buang perubahan?")) return;
    try {
      await api("/api/admin/logout", { method: "POST", body: "{}" });
      csrfToken = '';
      settingsDirty = false;
      configurationLoaded = false;
      rowsRequestController?.abort(); reportRequestController?.abort();
      reportRequestId += 1; participantRequestId += 1; optionsRequestId += 1;
      clearPrivateView();
      if (participantDialog.open) participantDialog.close();
      dashboard.hidden = true;
      loginCard.hidden = false;
      loginCard.querySelector("h1").focus();
    } catch (error) {
      showAlert(dashboardAlert, error.message || "Sesi belum dapat diakhiri. Coba lagi.");
    }
  });

  let activePage = 'ringkasan';
  let configurationLoaded = false;
  let lastOptionsView = '';
  let optionsRequestId = 0;
  let regionOptions = [];
  const pagePanels = { ringkasan: ['reports-panel'], peserta: ['waitinglist-panel'], analitik: ['analytics-panel'], arsip: ['waitinglist-panel'], pengaturan: ['settings-panel', 'brochure-panel', 'system-panel'] };

  function navigate(focus = true) {
    const requested = (window.location.hash || '#ringkasan').slice(1);
    activePage = Object.hasOwn(pagePanels, requested) ? requested : 'ringkasan';
    if (activePage === 'pengaturan' && !configurationLoaded) { configurationLoaded = true; loadSystem(); loadBrochure(); }
    if (activePage === 'peserta' || activePage === 'arsip') {
      const next = activePage === 'arsip' ? 'archived' : 'active';
      if (next !== currentView) {
        currentView = next;
        document.querySelector('#participant-view').value = next;
        currentPage = 1;
        loadRows(); loadReport(); loadFilterOptions();
      }
    }
    for (const id of new Set(Object.values(pagePanels).flat())) document.querySelector(`#${id}`).hidden = !pagePanels[activePage].includes(id);
    document.querySelector('.workspace-filters').hidden = activePage === 'pengaturan';
    document.querySelector('#waitinglist-title').textContent = currentView === 'archived' ? 'Arsip pendaftar' : 'Data pendaftar';
    for (const link of document.querySelectorAll('[data-page]')) {
      if (link.dataset.page === activePage) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    if (focus && !dashboard.hidden) document.querySelector(`#${pagePanels[activePage][0]} h2`).focus();
  }
  window.addEventListener('hashchange', () => navigate());

  function renderFilterChips() {
    const container = document.querySelector('#filter-chips');
    container.replaceChildren();
    for (const [key, value] of appliedFilters) {
      if (['sort', 'page_size', 'trend'].includes(key)) continue;
      const chip = document.createElement('span');
      chip.textContent = filterLabel(key, value);
      container.append(chip);
    }
  }
  function filterLabel(key, value) {
    const labels = { q: 'Pencarian', status: 'Kelayakan saat daftar', jenis_kelamin: 'Jenis kelamin', kecamatan: 'Kecamatan', provinsi: 'Provinsi', kabupaten: 'Kabupaten/kota', sekolah: 'Sekolah', missing: 'Belum tercatat', age_group: 'Usia saat daftar', tanggal_daftar_mulai: 'Daftar dari', tanggal_daftar_sampai: 'Daftar sampai', tanggal_lahir_mulai: 'Lahir dari', tanggal_lahir_sampai: 'Lahir sampai' };
    const values = { eligible: 'Memenuhi', not_eligible: 'Belum memenuhi', gender: 'Jenis kelamin', school: 'Sekolah', proof: 'Metadata lampiran', consent: 'Persetujuan', any: 'Ada kekosongan', under6: '<6 tahun', '6to7': '6–<7 tahun', '7to8': '7–<8 tahun', '8plus': '≥8 tahun', unknown: 'Belum tercatat', putra: 'Putra', putri: 'Putri' };
    return `${labels[key] || key}: ${values[value] || value}`;
  }
  function fillOptions(id, values) {
    const list = document.querySelector(id); list.replaceChildren();
    for (const value of [...new Set(values)].filter(Boolean).sort()) {
      const option = document.createElement('option'); option.value = value; list.append(option);
    }
  }
  function updateRegionOptions() {
    const province = filterForm.elements.provinsi.value.trim();
    const regency = filterForm.elements.kabupaten.value.trim();
    const regions = regionOptions.filter(row => !province || row.province === province);
    fillOptions('#regency-options', regions.map(row => row.regency));
    fillOptions('#district-options', regions.filter(row => !regency || row.regency === regency).map(row => row.district));
  }
  async function loadFilterOptions() {
    const id = ++optionsRequestId;
    const view = currentView;
    try {
      const result = await api(`/api/admin/filter-options?view=${view}`);
      if (id !== optionsRequestId) return;
      regionOptions = result.regions || [];
      fillOptions('#province-options', result.provinces || []);
      fillOptions('#school-options', result.schools || []);
      updateRegionOptions();
      lastOptionsView = view;
    } catch (error) { if (id === optionsRequestId) showAlert(dashboardAlert, `Opsi filter gagal dimuat: ${error.message}`); }
  }
  filterForm.addEventListener('input', () => { validateDateRanges(); updateRegionOptions(); });
  document.querySelector('#period-preset').addEventListener('change', event => {
    if (!event.target.value) return;
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    filterForm.elements.tanggal_daftar_sampai.value = today;
    filterForm.elements.tanggal_daftar_mulai.value = new Date(Date.parse(today) - (Number(event.target.value) - 1) * 86400000).toISOString().slice(0, 10);
    validateDateRanges();
  });
  document.querySelector('#retry-data').addEventListener('click', () => { loadRows(); loadReport(); loadFilterOptions(); });

  function expireSession() {
    csrfToken = '';
    configurationLoaded = false;
    if (dashboard.hidden) return;
    rowsRequestController?.abort(); reportRequestController?.abort();
    participantRequestId += 1; optionsRequestId += 1; reportRequestId += 1;
    clearPrivateView();
    if (participantDialog.open) participantDialog.close();
    dashboard.hidden = true; loginCard.hidden = false;
    showAlert(loginAlert, 'Sesi admin berakhir. Silakan masuk kembali.');
    loginCard.querySelector('h1').focus();
  }
  function clearPrivateView() {
    rowsContainer.replaceChildren();
    document.querySelector('#analytics-content').replaceChildren();
    for (const node of document.querySelectorAll('#participant-detail-grid dd')) node.replaceChildren();
    currentParticipantId = '';
    regionOptions = [];
  }
  function addCopyButton(selector, value) {
    if (!value) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'copy-button'; button.textContent = 'Salin';
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(value); button.textContent = 'Tersalin'; }
      catch { document.querySelector('#participant-detail-status').hidden = false; document.querySelector('#participant-detail-status').textContent = 'Tidak dapat menyalin otomatis. Pilih teks dan salin secara manual.'; }
    });
    document.querySelector(selector).append(button);
  }
  function addContact(selector, value, url) {
    if (url) {
      const link = document.createElement('a'); link.href = url; link.textContent = value; link.rel = 'noopener noreferrer';
      if (url.startsWith('https:')) link.target = '_blank';
      document.querySelector(selector).replaceChildren(link);
    }
    addCopyButton(selector, value);
  }
  function drillDown(filter) {
    for (const [key, value] of Object.entries(filter)) {
      appliedFilters.set(key, value);
      if (filterForm.elements[key]) filterForm.elements[key].value = value;
    }
    currentPage = 1;
    window.location.hash = currentView === 'archived' ? 'arsip' : 'peserta';
    navigate(); loadRows(); loadReport();
  }
  function renderAnalytics(report) {
    const content = document.querySelector('#analytics-content'); content.replaceChildren();
    if (!report.breakdowns) return;
    const recent = document.querySelector('#recent-stats'); recent.replaceChildren();
    for (const [label, value] of [['Hari ini', report.recent.today], ['7 hari terakhir', report.recent.week], ['30 hari terakhir', report.recent.month]]) {
      const item = document.createElement('article');
      const title = document.createElement('span'); title.textContent = label;
      const count = document.createElement('strong'); count.textContent = value;
      const note = document.createElement('small'); note.textContent = 'dalam cakupan filter terapan';
      item.append(title, count, note); recent.append(item);
    }
    document.querySelector('#analytics-meta').textContent = `${report.scope} · ${report.total} peserta · ${report.registrationPeriod.label} · diperbarui ${formatDate(report.generatedAt, true)} WIB`;
    document.querySelector('#analytics-filters').textContent = `Filter terapan: ${[...appliedFilters].filter(([key]) => !['sort', 'page_size', 'trend'].includes(key)).map(([key, value]) => filterLabel(key, value)).join(' · ') || 'Tanpa filter tambahan'}. Tren: ${report.trend.start} – ${report.trend.end} (${report.trend.interval}).`;
    const names = { provinsi: 'Sebaran provinsi', kabupaten: 'Kabupaten/kota', kecamatan: 'Kecamatan', sekolah: 'Sekolah asal', usia: 'Usia tercatat saat daftar', orangTua: 'Hubungan orang tua/wali', gender: 'Jenis kelamin', eligibility: 'Kelayakan saat daftar' };
    const sections = [
      ['Tren pendaftaran', report.trend.buckets.map(row => ({ label: row.date, total: row.total }))],
      ['Kelengkapan pencatatan', [{ label: 'Peserta dengan setidaknya satu kekosongan', total: report.completeness.any, filter: { missing: 'any' } }, ...report.completeness.fields]],
      ...Object.entries(report.breakdowns).map(([key, rows]) => [names[key] || key, rows]),
    ];
    for (const [title, rows] of sections) {
      const article = document.createElement('article'); article.className = 'analytics-card';
      const heading = document.createElement('h3'); heading.textContent = title;
      const table = document.createElement('table');
      const caption = document.createElement('caption'); caption.textContent = `${title} · ${report.total} peserta sesuai filter`; caption.className = 'sr-only';
      const head = document.createElement('thead'); const hr = document.createElement('tr');
      for (const label of ['Kategori', 'Jumlah', '% total']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; hr.append(th); } head.append(hr);
      const body = document.createElement('tbody');
      for (const row of rows) {
        const tr = document.createElement('tr'); const label = makeCell(row.label);
        if (row.filter) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'drilldown'; button.textContent = row.label;
          button.addEventListener('click', () => drillDown(row.filter)); label.replaceChildren(button);
        }
        tr.append(label, makeCell(String(row.total)), makeCell(row.percent === undefined ? '—' : `${row.percent}%`)); body.append(tr);
      }
      if (!rows.length) { const tr = document.createElement('tr'); const cell = makeCell('Tidak ada data sesuai filter.'); cell.colSpan = 3; tr.append(cell); body.append(tr); }
      table.append(caption, head, body); const scroll = document.createElement('div'); scroll.className = 'analytics-table-scroll'; scroll.tabIndex = 0; scroll.append(table);
      article.append(heading, scroll); content.append(article);
    }
  }
  async function download(url, button) {
    if (button) button.disabled = true;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 401) expireSession();
        const result = await response.json(); throw new Error(result.error || 'Unduhan gagal. Silakan coba lagi.');
      }
      const blob = await response.blob(); const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = objectUrl;
      link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'laporan-spsb.xlsx';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) { showAlert(dashboardAlert, error.message); }
    finally { if (button) button.disabled = false; }
  }

  restoreSession();
})();
