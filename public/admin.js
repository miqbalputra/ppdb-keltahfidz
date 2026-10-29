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
  let staffUser = { role: "admin", name: "", username: "", mustChangePassword: false };
  let currentParticipant = null;
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
  const dirtyDialogForms = new Set();

  function canCloseDialog(dialog) {
    if (dialog.hasAttribute('data-saving')) return false;
    return ![...dirtyDialogForms].some(form => form.closest('dialog') === dialog)
      || window.confirm('Ada perubahan yang belum disimpan. Tutup dan buang perubahan?');
  }
  function closeDialog(dialog) { if (canCloseDialog(dialog)) dialog.close(); }
  function lockDialogForm(form) {
    const dialog = form.closest?.('dialog');
    const controls = [...(form.querySelectorAll?.('input, select, textarea, button') || []), ...(dialog?.querySelectorAll('[data-close], #close-participant-dialog') || [])];
    const states = controls.map(control => [control, control.disabled]);
    for (const [control] of states) control.disabled = true;
    dialog?.setAttribute('data-saving', 'true');
    let locked = true;
    return () => {
      if (!locked) return;
      locked = false;
      for (const [control, disabled] of states) control.disabled = disabled;
      dialog?.removeAttribute('data-saving');
    };
  }
  for (const dialog of document.querySelectorAll('dialog')) {
    for (const form of dialog.querySelectorAll('form')) {
      form.addEventListener('input', () => dirtyDialogForms.add(form));
      form.addEventListener('change', () => dirtyDialogForms.add(form));
      form.addEventListener('reset', () => dirtyDialogForms.delete(form));
    }
    dialog.addEventListener('cancel', event => {
      if ((dialog.id === 'password-dialog' && staffUser.mustChangePassword) || !canCloseDialog(dialog)) event.preventDefault();
    });
    dialog.addEventListener('close', () => { for (const form of dialog.querySelectorAll('form')) dirtyDialogForms.delete(form); });
  }
  for (const input of document.querySelectorAll('input[type="password"]')) {
    const control = document.createElement('div'); control.className = 'password-control';
    input.before(control); control.append(input);
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = 'Tampilkan';
    toggle.setAttribute('aria-label', 'Tampilkan ' + (input.closest('label')?.querySelector('span')?.textContent || 'password'));
    toggle.setAttribute('aria-pressed', 'false');
    const hide = () => { input.type = 'password'; toggle.textContent = 'Tampilkan'; toggle.setAttribute('aria-pressed', 'false'); };
    toggle.addEventListener('click', () => {
      const show = input.type === 'password'; input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Sembunyikan' : 'Tampilkan'; toggle.setAttribute('aria-pressed', String(show));
    });
    input.form?.addEventListener('reset', hide); control.append(toggle);
  }

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
    if (!response.ok) { const error = new Error(payload?.error || "Permintaan tidak berhasil."); error.status = response.status; error.code = payload?.code; throw error; }
    return payload;
  }

  function showDashboard(focusHeading = false) {
    applyStaffPermissions();
    if (staffUser.mustChangePassword) { openPasswordDialog(); return; }
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
        staffUser = result.user || staffUser;
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
      td.colSpan = 8;
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
      const payment = document.createElement('td');
      const paymentBadge = document.createElement('span'); paymentBadge.className = 'payment-badge ' + (item.payment_status || 'pending');
      paymentBadge.textContent = paymentLabel(item.payment_status); payment.append(paymentBadge);
      const paymentInfo = document.createElement('small'); paymentInfo.textContent = item.payment_reviewer || 'Menunggu pemeriksaan'; payment.append(paymentInfo);
      tr.append(payment); rowsContainer.append(tr);
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
      document.querySelector("#table-summary").textContent = `${new Intl.NumberFormat("id-ID").format(result.total)} pendaftar ${currentView === "all" ? "aktif dan arsip" : currentView === "archived" ? "diarsipkan" : "aktif"} · halaman ${result.page} dari ${result.pages}`;
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
    cell.colSpan = 8;
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
    document.querySelector('#scope-label').textContent = currentView === 'all' ? 'AKTIF DAN ARSIP' : currentView === 'archived' ? 'DATA ARSIP' : 'DATA AKTIF';
    document.querySelector('#report-filter-status').textContent = 'Memuat cakupan filter terapan…';
    ["#report-total", "#report-putra", "#report-putri", "#report-eligible", "#report-gender-unrecorded", "#report-not-eligible"]
      .forEach((selector) => { document.querySelector(selector).textContent = "Memuat…"; });
    renderDailyReport([]);
    renderAreaReport([]);
    document.querySelector('#payment-kpis').textContent = 'Memuat pemeriksaan pembayaran…';
    document.querySelector('#payment-trend').replaceChildren();
    for (const id of ['export-report-pdf', 'export-payment-xlsx', 'export-payment-pdf']) document.querySelector('#' + id).disabled = true;
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
      document.querySelector('#scope-label').textContent = currentView === 'all' ? 'AKTIF DAN ARSIP' : currentView === 'archived' ? 'DATA ARSIP' : 'DATA AKTIF';
      document.querySelector('#report-filter-status').textContent = `${currentView === 'all' ? 'Aktif dan arsip' : currentView === 'archived' ? 'Arsip' : 'Aktif'} · ${activeFilters} filter terapan · laporan, tabel, dan ekspor memakai cakupan yang sama.`;
      const firstTrendDate = report.daily[0]?.date;
      const lastTrendDate = report.daily.at(-1)?.date;
      document.querySelector("#report-trend-period").textContent = report.registrationPeriod.label === "Semua pendaftar"
        ? "30 hari terakhir"
        : firstTrendDate && lastTrendDate ? `${formatDate(firstTrendDate)} – ${formatDate(lastTrendDate)}` : "Tidak ada tanggal pada filter";
      if (report.trend) document.querySelector('#report-trend-period').textContent = `${formatDate(report.trend.start)} – ${formatDate(report.trend.end)} · ${intervalLabel(report.trend.interval)}`;
      renderDailyReport(report.trend?.buckets || report.daily);
      renderAreaReport(report.topDistricts);
      renderAnalytics(report);
      renderPayments(report);
      for (const id of ['export-report-pdf', 'export-payment-xlsx', 'export-payment-pdf']) document.querySelector('#' + id).disabled = false;
      document.querySelector('#export-report').disabled = false;
      document.querySelector('#print-report').disabled = false;
    } catch (error) {
      if (controller.signal.aborted || requestId !== reportRequestId) return;
      document.querySelector("#payment-kpis").textContent = "Data pembayaran gagal dimuat. Gunakan Muat ulang data.";
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
    currentParticipant = null;
    if (!participantDialog.open) participantDialog.showModal();
    document.querySelector("#payment-review").hidden = true;
    document.querySelector("#participant-history").hidden = true;
    participantDialog.setAttribute("aria-busy", "true");
    document.querySelector("#participant-detail-status").hidden = false;
    document.querySelector("#participant-detail-status").textContent = "Memuat detail pendaftaran…";
    document.querySelector("#participant-detail-grid").hidden = true;
    document.querySelector("#participant-detail-actions").hidden = true;
    try {
      const participant = await api(`/api/admin/waitinglist/${encodeURIComponent(id)}`);
      if (requestId !== participantRequestId || !participantDialog.open) return;
      currentParticipant = participant;
      const setDetail = (selector, value) => { document.querySelector(selector).textContent = value || "Belum dicatat"; };
      const isArchived = Boolean(participant.deleted_at);
      document.querySelector("#archive-participant-button").hidden = isArchived || staffUser.role !== "admin";
      document.querySelector("#restore-participant-button").hidden = !isArchived || staffUser.role !== "admin";
      document.querySelector("#detail-pdf-link").hidden = false;
      document.querySelector("#edit-participant").hidden = isArchived || staffUser.role !== "admin";
      document.querySelector("#detail-xlsx-link").hidden = false;
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
      setDetail('#detail-age', !Number.isFinite(participant.umur_terhitung_bulan) ? 'Belum tercatat' : `${formatAge(participant.umur_terhitung_bulan)} (${participant.umur_terhitung_bulan} bulan)`);
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
      fillPaymentReview(participant);
      loadParticipantHistory(id, requestId);
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
    document.querySelector('#lifecycle-title').textContent = archive ? 'Arsipkan pendaftar' : 'Pulihkan pendaftar';
    pendingLifecycleAction = action;
    lifecycleForm.reset(); showAlert(document.querySelector('#lifecycle-alert'), '');
    document.querySelector('#lifecycle-dialog').showModal();
  }
  async function submitParticipantLifecycle(action, reason) {
    const archive = action === 'archive';
    const button = document.querySelector(archive ? "#archive-participant-button" : "#restore-participant-button");
    button.disabled = true;
    try {
      await api(`/api/admin/waitinglist/${encodeURIComponent(currentParticipantId)}/${action}`, { method: "POST", body: JSON.stringify({ version: currentParticipant.version, reason }) });
      document.querySelector("#lifecycle-dialog").close();
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
      showAlert(document.querySelector("#lifecycle-alert"), error.message);
    } finally {
      button.disabled = false;
    }
  }

  document.querySelector("#archive-participant-button").addEventListener("click", () => changeParticipantLifecycle("archive"));
  document.querySelector("#restore-participant-button").addEventListener("click", () => changeParticipantLifecycle("restore"));
  document.querySelector("#close-participant-dialog").addEventListener("click", () => closeDialog(participantDialog));
  participantDialog.addEventListener("click", (event) => {
    if (event.target !== participantDialog) return;
    const rect = participantDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(participantDialog);
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
      staffUser = result.user || staffUser;
      configurationLoaded = false;
      if (staffUser.role === "bendahara" && !window.location.hash) window.location.hash = "pembayaran";
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
    if (!settingsDirty && !dirtyDialogForms.size) return;
    event.preventDefault();
    event.returnValue = "";
  });

  function validateDateRanges() {
    const ranges = [
      ["tanggal_daftar_mulai", "tanggal_daftar_sampai", "tanggal pendaftaran"],
      ["tanggal_lahir_mulai", "tanggal_lahir_sampai", "tanggal lahir"],
      ["tanggal_bayar_mulai", "tanggal_bayar_sampai", "tanggal pembayaran"],
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
    currentView = activePage === 'pembayaran' ? 'all' : activePage === 'arsip' ? 'archived' : 'active';
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
    if ((settingsDirty || dirtyDialogForms.size) && !window.confirm("Ada perubahan yang belum disimpan. Tetap keluar dan buang perubahan?")) return;
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
  let previousNavigationPage = '';
  let configurationLoaded = false;
  let lastOptionsView = '';
  let optionsRequestId = 0;
  let regionOptions = [];
  const pagePanels = { pembayaran: ['payments-panel', 'waitinglist-panel'], akun: ['users-panel'], ringkasan: ['reports-panel'], peserta: ['waitinglist-panel'], analitik: ['analytics-panel'], arsip: ['waitinglist-panel'], pengaturan: ['settings-panel', 'brochure-panel', 'system-panel'] };

  function navigate(focus = true) {
    const requested = (window.location.hash || '#ringkasan').slice(1);
    activePage = Object.hasOwn(pagePanels, requested) ? requested : 'ringkasan';
    if (staffUser.role !== 'admin' && ['akun', 'pengaturan'].includes(activePage)) activePage = 'pembayaran';
    if (activePage === 'akun') loadUsers();
    if (activePage === 'pengaturan' && !configurationLoaded) { configurationLoaded = true; loadSystem(); loadBrochure(); }
    if (activePage === 'peserta' || activePage === 'arsip' || activePage === 'pembayaran') {
      const next = activePage === 'pembayaran' ? (previousNavigationPage === 'pembayaran' ? currentView : 'all') : activePage === 'arsip' ? 'archived' : (currentView === 'archived' ? 'active' : currentView);
      if (next !== currentView) {
        currentView = next;
        document.querySelector('#participant-view').value = next;
        currentPage = 1;
        loadRows(); loadReport(); loadFilterOptions();
      }
    }
    for (const id of new Set(Object.values(pagePanels).flat())) document.querySelector(`#${id}`).hidden = !pagePanels[activePage].includes(id);
    previousNavigationPage = activePage;
    document.querySelector('.workspace-filters').hidden = ['pengaturan', 'akun'].includes(activePage);
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
    const basicFilterKeys = new Set(['q', 'view', 'status', 'jenis_kelamin', 'kecamatan', 'sort', 'page_size', 'trend']);
    const activeAdditionalFilters = [...appliedFilters.keys()].filter(key => !basicFilterKeys.has(key)).length;
    const additionalCount = document.querySelector('#filter-options-count');
    additionalCount.textContent = activeAdditionalFilters ? `${activeAdditionalFilters} aktif` : 'Opsional';
    additionalCount.classList.toggle('is-active', activeAdditionalFilters > 0);
    for (const [key, value] of appliedFilters) {
      if (['sort', 'page_size', 'trend'].includes(key)) continue;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = filterLabel(key, value);
      chip.setAttribute('aria-label', `Hapus filter ${filterLabel(key, value)}`);
      chip.addEventListener('click', () => {
        appliedFilters.delete(key);
        const field = filterForm.elements[key];
        if (field) field.value = field.tagName === 'SELECT' ? 'all' : '';
        validateDateRanges(); updateRegionOptions(); currentPage = 1; loadRows(); loadReport();
      });
      container.append(chip);
    }
  }
  function filterLabel(key, value) {
    const labels = { payment_status: 'Pembayaran', payment_reviewer: 'Pemeriksa', tanggal_bayar_mulai: 'Bayar dari', tanggal_bayar_sampai: 'Bayar sampai', q: 'Pencarian', status: 'Kelayakan saat daftar', jenis_kelamin: 'Jenis kelamin', kecamatan: 'Kecamatan', provinsi: 'Provinsi', kabupaten: 'Kabupaten/kota', sekolah: 'Sekolah', missing: 'Belum tercatat', age_group: 'Usia saat daftar', tanggal_daftar_mulai: 'Daftar dari', tanggal_daftar_sampai: 'Daftar sampai', tanggal_lahir_mulai: 'Lahir dari', tanggal_lahir_sampai: 'Lahir sampai' };
    const values = { pending: 'Belum diperiksa', verified: 'Terverifikasi', needs_correction: 'Perlu perbaikan', eligible: 'Memenuhi', not_eligible: 'Belum memenuhi', gender: 'Jenis kelamin', school: 'Sekolah', proof: 'Metadata lampiran', consent: 'Persetujuan', any: 'Ada kekosongan', under6: '<6 tahun', '6to7': '6–<7 tahun', '7to8': '7–<8 tahun', '8plus': '≥8 tahun', unknown: 'Belum tercatat', putra: 'Putra', putri: 'Putri' };
    return `${labels[key] || key}: ${Object.hasOwn(values, value) ? values[value] : value}`;
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
      fillOptions("#reviewer-options", result.reviewers || []);
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
  for (const key of ['sort', 'page_size', 'trend']) filterForm.elements[key].addEventListener('change', () => {
    const value = filterForm.elements[key].value;
    if (value === ({ sort: 'newest', page_size: '25', trend: 'auto' })[key]) appliedFilters.delete(key);
    else appliedFilters.set(key, value);
    currentPage = 1;
    if (key !== 'trend') loadRows();
    else loadReport();
  });
  document.querySelector('#retry-data').addEventListener('click', () => { loadRows(); loadReport(); loadFilterOptions(); });

  function expireSession() {
    csrfToken = '';
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
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
    dirtyDialogForms.clear();
    usersRequestId++;
    currentParticipant = null;
    for (const id of ['users-rows', 'history-content', 'payment-kpis', 'payment-trend']) document.querySelector('#' + id).replaceChildren();
    for (const id of ['participant-editor-form', 'payment-form', 'user-form', 'reset-password-form', 'password-form']) document.querySelector('#' + id).reset();
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
    document.querySelector('#analytics-filters').textContent = `Filter terapan: ${[...appliedFilters].filter(([key]) => !['sort', 'page_size', 'trend'].includes(key)).map(([key, value]) => filterLabel(key, value)).join(' · ') || 'Tanpa filter tambahan'}. Tren: ${report.trend.start} – ${report.trend.end} (${intervalLabel(report.trend.interval)}).`;
    const names = { provinsi: 'Sebaran provinsi', kabupaten: 'Kabupaten/kota', kecamatan: 'Kecamatan', sekolah: 'Sekolah asal', usia: 'Usia tercatat saat daftar', orangTua: 'Hubungan orang tua/wali', gender: 'Jenis kelamin', eligibility: 'Kelayakan saat daftar' };
    const sections = [
      ['Tren pendaftaran', report.trend.buckets.map(row => ({ label: row.date, total: row.total }))],
      ...(report.payments ? [['Status pembayaran', ['pending', 'verified', 'needs_correction'].map(status => ({ label: paymentLabel(status), total: report.payments[status], percent: report.total ? Math.round(report.payments[status] / report.total * 1000) / 10 : 0, filter: { payment_status: status } }))]] : []),
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

  function intervalLabel(value) { return ({ daily: 'harian', weekly: 'mingguan', monthly: 'bulanan', yearly: 'tahunan' })[value] || value.replace(/^(\d+)-year$/, 'per $1 tahun'); }
  function paymentLabel(status) {
    return status === 'verified' ? 'Terverifikasi' : status === 'needs_correction' ? 'Perlu perbaikan' : 'Belum diperiksa';
  }
  function applyStaffPermissions() {
    const admin = staffUser.role === 'admin';
    document.querySelector('#staff-role-label').textContent = `SPSB 2027 · ${admin ? 'ADMIN' : 'BENDAHARA'}`;
    document.querySelector('#staff-name-label').textContent = staffUser.name || staffUser.username;
    for (const id of ['akun', 'pengaturan', 'add-participant']) document.querySelector('#' + id).hidden = !admin;
  }
  function renderPayments(report) {
    const container = document.querySelector('#payment-kpis'); container.replaceChildren();
    const trend = document.querySelector('#payment-trend'); trend.replaceChildren();
    if (!report.payments) return;
    const payment = report.payments;
    document.querySelector('#payment-scope-note').textContent = `${report.scope} · ${report.total} peserta sesuai filter. Biaya tetap Rp150.000. Pembayaran peserta arsip tetap tersimpan.`;
    const stats = [
      ['Belum diperiksa', payment.pending, { payment_status: 'pending' }, 'menunggu pemeriksaan petugas'],
      ['Terverifikasi', payment.verified, { payment_status: 'verified' }, `${payment.verifiedPercent}% dari peserta sesuai filter`],
      ['Perlu perbaikan', payment.needs_correction, { payment_status: 'needs_correction' }, 'lihat catatan pemeriksa'],
      ['Nominal tervalidasi', 'Rp' + payment.verifiedAmount.toLocaleString('id-ID'), { payment_status: 'verified' }, 'hanya pembayaran terverifikasi'],
      ['Tanpa metadata bukti', payment.withoutProof, { missing: 'proof' }, 'berkas belum tercatat'],
      ['Biaya pendaftaran', 'Rp150.000', {}, 'satu pembayaran per peserta'],
    ];
    for (const [label, value, filter, note] of stats) {
      const card = document.createElement('button'); card.type = 'button';
      const title = document.createElement('span'); title.textContent = label;
      const count = document.createElement('strong'); count.textContent = value;
      const hint = document.createElement('small'); hint.textContent = note;
      card.append(title, count, hint); card.addEventListener('click', () => drillDown(filter)); container.append(card);
    }
    document.querySelector('#payment-trend-period').textContent = `${formatDate(payment.trend.start)} – ${formatDate(payment.trend.end)} · ${intervalLabel(payment.trend.interval)} · menurut tanggal pembayaran (WIB)`;
    const max = Math.max(1, ...payment.trend.buckets.map(row => row.amount));
    for (const row of payment.trend.buckets) {
      const li = document.createElement('li'); const date = document.createElement('span'); date.textContent = row.date;
      const meter = document.createElement('meter'); meter.min = 0; meter.max = max; meter.value = row.amount;
      meter.setAttribute('aria-label', `${row.date}: ${row.total} pembayaran, Rp${row.amount.toLocaleString('id-ID')}`);
      const value = document.createElement('span'); value.textContent = `Rp${row.amount.toLocaleString('id-ID')}`;
      li.append(date, meter, value); trend.append(li);
    }
  }
  for (const [id, path] of [['export-participants-pdf', '/api/admin/export.pdf'], ['export-report-pdf', '/api/admin/report.pdf'],
    ['export-payment-xlsx', '/api/admin/payments/export.xlsx'], ['export-payment-pdf', '/api/admin/payments/export.pdf']]) {
    document.querySelector('#' + id).addEventListener('click', event => download(`${path}?${filtersQuery()}`, event.currentTarget));
  }

  const paymentForm = document.querySelector('#payment-form');
  function updatePaymentRequirements() {
    const verified = paymentForm.elements.status.value === 'verified';
    paymentForm.elements.date.required = verified;
    paymentForm.elements.date.disabled = !verified;
    paymentForm.elements.amountConfirmed.required = verified;
    paymentForm.elements.amountConfirmed.disabled = !verified;
    paymentForm.elements.note.required = paymentForm.elements.status.value === 'needs_correction' || currentParticipant?.payment_status !== 'pending';
    paymentForm.elements.note.minLength = paymentForm.elements.note.required ? 3 : 0;
    paymentForm.elements.date.max = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  }
  function fillPaymentReview(participant) {
    paymentForm.reset();
    paymentForm.elements.status.value = participant.payment_status || 'pending';
    paymentForm.elements.date.value = participant.payment_date || '';
    paymentForm.elements.note.value = '';
    paymentForm.elements.amountConfirmed.checked = false;
    document.querySelector('#payment-current-status').textContent = `${paymentLabel(participant.payment_status)}${participant.payment_reviewer ? ` · ${participant.payment_reviewer} · ${formatDate(participant.payment_reviewed_at, true)} WIB` : ''}${participant.payment_note ? ` · ${participant.payment_note}` : ''}`;
    showAlert(document.querySelector('#payment-alert'), '');
    document.querySelector('#payment-review').hidden = false; updatePaymentRequirements();
  }
  paymentForm.elements.status.addEventListener('change', updatePaymentRequirements);
  paymentForm.addEventListener('submit', async event => {
    event.preventDefault(); if (!currentParticipant || !paymentForm.reportValidity()) return;
    const participant = currentParticipant, requestId = participantRequestId;
    const payload = { version: participant.version, status: paymentForm.elements.status.value, date: paymentForm.elements.date.value,
      note: paymentForm.elements.note.value, amountConfirmed: paymentForm.elements.amountConfirmed.checked };
    const button = paymentForm.querySelector('button[type="submit"]'); button.disabled = true;
    const unlock = lockDialogForm(paymentForm);
    try {
      await api(`/api/admin/waitinglist/${participant.id}/payment`, { method: 'PUT', body: JSON.stringify(payload) });
      unlock();
      dirtyDialogForms.delete(paymentForm);
      if (!dashboard.hidden) { loadRows(); loadReport(); loadFilterOptions(); }
      if (requestId === participantRequestId && participantDialog.open) {
        await showParticipantDetail(participant.id);
        showAlert(document.querySelector('#payment-alert'), 'Hasil pemeriksaan tersimpan dan tercatat dalam riwayat.', 'success');
      }
    } catch (error) { if (requestId === participantRequestId && participantDialog.open) showAlert(document.querySelector('#payment-alert'), error.message); }
    finally { unlock(); button.disabled = false; }
  });
  document.querySelector('#reload-detail').addEventListener('click', () => currentParticipantId && showParticipantDetail(currentParticipantId));
  async function loadParticipantHistory(id, requestId) {
    const container = document.querySelector('#history-content'); container.replaceChildren();
    document.querySelector('#participant-history').hidden = false;
    container.textContent = 'Memuat riwayat…';
    try {
      const history = await api(`/api/admin/waitinglist/${id}/history`);
      if (requestId !== participantRequestId || !participantDialog.open) return;
      container.replaceChildren();
      const names = { participant_created: 'Pendaftaran dibuat', participant_updated: 'Data pendaftar diubah', participant_updated_proof: 'Data dan bukti transfer diperbarui; pemeriksaan diulang',
        participant_archived: 'Pendaftar diarsipkan', participant_restored: 'Pendaftar dipulihkan', payment_reviewed: 'Pembayaran diperiksa' };
      for (const entry of history.events || []) {
        const item = document.createElement('article'); item.className = 'history-item';
        const title = document.createElement('strong'); title.textContent = names[entry.action] || entry.action;
        const meta = document.createElement('small'); meta.textContent = `${entry.actor} · ${formatDate(entry.created_at, true)} WIB`;
        const note = document.createElement('p'); note.textContent = entry.details.reason || entry.details.after?.note || '';
        item.append(title, meta, note);
        if (entry.action === 'payment_reviewed') {
          const status = document.createElement('p'); status.textContent = `${paymentLabel(entry.details.before?.status)} → ${paymentLabel(entry.details.after?.status)}${entry.details.after?.date ? ' · tanggal bayar ' + entry.details.after.date : ''}`;
          item.append(status);
        } else if (entry.details.before && entry.details.after) {
          const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Lihat perubahan data';
          const dl = document.createElement('dl');
          const labels = { nama_anak: 'Nama calon santri', nama_ortu: 'Nama orang tua', status_ortu: 'Hubungan orang tua', jenis_kelamin: 'Jenis kelamin', sekolah_asal: 'Sekolah asal', tanggal_lahir_anak: 'Tanggal lahir', umur_terhitung_bulan: 'Usia saat mendaftar (bulan)', status_eligibility: 'Kelayakan saat mendaftar', provinsi_nama: 'Provinsi', kabupaten_nama: 'Kabupaten/kota', kecamatan_nama: 'Kecamatan', desa_nama: 'Desa/kelurahan', no_hp_wa: 'WhatsApp', email: 'Email', konfirmasi_data: 'Persetujuan data', konfirmasi_bukti_transfer: 'Konfirmasi pengiriman bukti', konfirmasi_ketentuan_biaya: 'Persetujuan biaya', payment_status: 'Status pembayaran', payment_date: 'Tanggal pembayaran', payment_reviewer: 'Pemeriksa', payment_reviewed_at: 'Waktu pemeriksaan', payment_note: 'Catatan pembayaran' };
          const readableValue = (key, value) => {
            if (value === null || value === undefined || value === '') return 'Belum dicatat';
            if (key.startsWith('konfirmasi_')) return Number(value) === 1 ? 'Disetujui/dikonfirmasi' : 'Belum dikonfirmasi';
            if (key === 'status_eligibility') return value === 'eligible' ? 'Memenuhi saat mendaftar' : value === 'not_eligible' ? 'Belum memenuhi saat mendaftar' : 'Belum dicatat';
            if (key === 'payment_status') return paymentLabel(value);
            if (['tanggal_lahir_anak', 'payment_date', 'payment_reviewed_at'].includes(key)) return formatDate(value, key === 'payment_reviewed_at');
            if (['status_ortu', 'jenis_kelamin'].includes(key)) {
              const options = { bapak: 'Bapak', ibu: 'Ibu', putra: 'Putra', putri: 'Putri' };
              return Object.hasOwn(options, value) ? options[value] : String(value);
            }
            return String(value);
          };
          for (const [key, value] of Object.entries(entry.details.after)) {
            if (['created_at', 'proofId'].includes(key) || key.endsWith('_id') || String(entry.details.before[key] ?? '') === String(value ?? '')) continue;
            const dt = document.createElement('dt'); dt.textContent = labels[key] || key.replaceAll('_', ' ');
            const dd = document.createElement('dd'); dd.textContent = `${readableValue(key, entry.details.before[key])} → ${readableValue(key, value)}`; dl.append(dt, dd);
          }
          details.append(summary, dl); item.append(details);
        }
        container.append(item);
      }
      if (!(history.events || []).length) container.textContent = 'Belum ada riwayat perubahan yang tercatat.';
      for (const proof of history.proofs || []) {
        const a = document.createElement('a'); a.className = 'history-proof';
        a.href = `/api/admin/waitinglist/${id}/proof?version=${encodeURIComponent(proof.id)}`;
        a.textContent = `Unduh versi bukti · ${formatDate(proof.created_at, true)} WIB · ${proof.created_by || 'Pendaftaran awal'} (${proof.size > 0 ? Math.ceil(proof.size / 1024) + ' KB' : 'ukuran belum tercatat'})`; container.append(a);
      }
    } catch (error) { if (requestId === participantRequestId && participantDialog.open) container.textContent = error.message; }
  }

  let pendingLifecycleAction = '';
  const lifecycleForm = document.querySelector('#lifecycle-form');
  lifecycleForm.addEventListener('submit', async event => {
    event.preventDefault(); if (!lifecycleForm.reportValidity()) return;
    const button = lifecycleForm.querySelector('button[type="submit"]'); button.disabled = true;
    const unlock = lockDialogForm(lifecycleForm);
    try { await submitParticipantLifecycle(pendingLifecycleAction, lifecycleForm.elements.reason.value); }
    finally { unlock(); button.disabled = false; }
  });
  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => closeDialog(document.querySelector('#' + button.dataset.close)));
  }

  const editor = document.querySelector('#participant-editor'), editorForm = document.querySelector('#participant-editor-form');
  let editingParticipant = null, editorEpoch = 0, editorBirthdateLimit = '';
  function validateEditorBirthdate() {
    const field = editorForm.elements.tanggal_lahir_anak;
    field.setCustomValidity(field.value && field.value !== editingParticipant?.tanggal_lahir_anak && editorBirthdateLimit && field.value > editorBirthdateLimit
      ? `Tanggal lahir untuk aturan saat ini paling lambat ${formatDate(editorBirthdateLimit)}.` : '');
  }
  editorForm.elements.tanggal_lahir_anak.addEventListener('input', validateEditorBirthdate);
  editorForm.elements.tanggal_lahir_anak.addEventListener('change', validateEditorBirthdate);
  function validateEditorContact() {
    const field = editorForm.elements.no_hp_wa;
    const raw = field.value.replace(/[^0-9+]/g, '');
    const normalized = raw.startsWith('+62') ? raw.slice(1) : raw.startsWith('0') ? '62' + raw.slice(1) : raw;
    field.setCustomValidity(raw && !/^628\d{8,12}$/.test(normalized) ? 'Nomor WhatsApp harus nomor seluler Indonesia yang valid, diawali 08 atau 628.' : '');
    if (raw && !field.validationMessage) field.value = normalized;
  }
  editorForm.elements.no_hp_wa.addEventListener('blur', validateEditorContact);
  editorForm.elements.no_hp_wa.addEventListener('input', () => editorForm.elements.no_hp_wa.setCustomValidity(''));
  editorForm.elements.bukti_transfer.addEventListener('change', () => {
    const field = editorForm.elements.bukti_transfer;
    field.setCustomValidity(field.files[0]?.size > 5 * 1024 * 1024 ? 'Ukuran bukti transfer maksimal 5 MB.' : '');
  });
  const regionLevels = ['provinsi', 'kabupaten', 'kecamatan', 'desa'];
  const regionEndpoints = ['provinces', 'regencies', 'districts', 'villages'];
  function resetEditorRegion(index) {
    const select = editorForm.elements[regionLevels[index] + '_id']; select.replaceChildren();
    const option = document.createElement('option'); option.value = ''; option.textContent = 'Pilih wilayah'; select.append(option); select.disabled = true;
  }
  async function loadEditorRegion(index, parent = '', selected = '', epoch = editorEpoch) {
    const select = editorForm.elements[regionLevels[index] + '_id']; resetEditorRegion(index);
    const result = await api(`/api/regions/${regionEndpoints[index]}${parent ? '?parent_id=' + encodeURIComponent(parent) : ''}`);
    if (epoch !== editorEpoch || !editor.open || (index && editorForm.elements[regionLevels[index - 1] + '_id'].value !== parent)) return;
    for (const row of result.items) { const option = document.createElement('option'); option.value = row.id; option.textContent = row.name; select.append(option); }
    select.disabled = false; select.value = selected;
  }
  for (let i = 0; i < 3; i++) editorForm.elements[regionLevels[i] + '_id'].addEventListener('change', async event => {
    const epoch = ++editorEpoch; for (let j = i + 1; j < 4; j++) resetEditorRegion(j);
    document.querySelector('#editor-save').disabled = true;
    try {
      if (event.target.value) await loadEditorRegion(i + 1, event.target.value, '', epoch);
    } catch (error) {
      if (epoch !== editorEpoch || !editor.open) return;
      showAlert(document.querySelector('#editor-alert'), error.message + ' Gunakan Coba muat wilayah lagi.');
      document.querySelector('#retry-editor-regions').hidden = false;
    } finally {
      if (epoch === editorEpoch && editor.open) document.querySelector('#editor-save').disabled = !editorBirthdateLimit;
    }
  });
  editor.addEventListener('close', () => { editorEpoch++; });
  async function prepareEditorReferences(epoch) {
    let useStored = true;
    const choices = regionLevels.map(name => {
      const select = editorForm.elements[name + '_id'];
      const id = select.value || (useStored ? editingParticipant?.[name + '_id'] : '') || '';
      const label = select.value ? select.options[select.selectedIndex].textContent : editingParticipant?.[name + '_nama'] || '';
      useStored = useStored && id === editingParticipant?.[name + '_id'];
      return { id, label };
    });
    let rulesLoaded = false;
    document.querySelector('#editor-save').disabled = true;
    document.querySelector('#retry-editor-regions').hidden = true;
    showAlert(document.querySelector('#editor-alert'), '');
    try {
      const config = await api('/api/config');
      if (epoch !== editorEpoch || !editor.open) return;
      const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
      editorBirthdateLimit = config.eligibleBirthdate < today ? config.eligibleBirthdate : today;
      editorForm.elements.tanggal_lahir_anak.max = today;
      document.querySelector('#editor-age-hint').textContent = `Batas tanggal lahir sesuai aturan saat ini: ${formatDate(editorBirthdateLimit)}.${editingParticipant ? ' Usia dan kelayakan saat daftar dipertahankan jika tanggal lahir tetap.' : ''}`;
      validateEditorBirthdate(); rulesLoaded = true;
      for (let i = 0; i < 4; i++) {
        if (i && !choices[i - 1].id) break;
        await loadEditorRegion(i, i ? choices[i - 1].id : '', choices[i].id, epoch);
        if (epoch !== editorEpoch || !editor.open) return;
      }
    } catch (error) {
      if (epoch !== editorEpoch || !editor.open) return;
      // Keep already recorded locations usable for a contact correction during an upstream outage.
      for (let i = 0; i < 4; i++) {
        resetEditorRegion(i);
        if (!choices[i].id) continue;
        const select = editorForm.elements[regionLevels[i] + '_id'], option = document.createElement('option');
        option.value = choices[i].id; option.textContent = choices[i].label; select.append(option); select.value = choices[i].id; select.disabled = false;
      }
      showAlert(document.querySelector('#editor-alert'), `${error.message} ${rulesLoaded && editingParticipant ? 'Wilayah yang sudah tercatat tetap dapat digunakan.' : 'Muat ulang agar pilihan wilayah tersedia.'}`);
      document.querySelector('#retry-editor-regions').hidden = false;
    } finally { if (epoch === editorEpoch) document.querySelector('#editor-save').disabled = !rulesLoaded; }
  }
  document.querySelector('#retry-editor-regions').addEventListener('click', () => prepareEditorReferences(++editorEpoch));
  async function openParticipantEditor(participant = null) {
    editingParticipant = participant; const epoch = ++editorEpoch; editorForm.reset();
    editorBirthdateLimit = ''; editorForm.elements.tanggal_lahir_anak.setCustomValidity('');
    editorForm.elements.no_hp_wa.setCustomValidity(''); editorForm.elements.bukti_transfer.setCustomValidity('');
    document.querySelector('#editor-title').textContent = participant ? 'Ubah data pendaftar' : 'Tambah pendaftar';
    document.querySelector('#editor-proof-hint').textContent = participant ? 'Kosongkan untuk mempertahankan bukti saat ini. Bukti baru akan mengulang pemeriksaan pembayaran.' : 'Bukti wajib diunggah.';
    document.querySelector('#editor-reason-field').hidden = !participant; editorForm.elements.reason.required = Boolean(participant);
    editorForm.elements.bukti_transfer.required = !participant?.has_proof;
    for (const key of ['nama_anak', 'nama_ortu', 'tanggal_lahir_anak', 'no_hp_wa', 'email', 'sekolah_asal', 'status_ortu', 'jenis_kelamin']) editorForm.elements[key].value = participant?.[key] || '';
    for (const key of ['konfirmasi_data', 'konfirmasi_bukti_transfer', 'konfirmasi_ketentuan_biaya']) editorForm.elements[key].checked = participant?.[key] === 1;
    for (let i = 0; i < 4; i++) resetEditorRegion(i);
    showAlert(document.querySelector('#editor-alert'), ''); editor.showModal();
    await prepareEditorReferences(epoch);
  }
  document.querySelector('#add-participant').addEventListener('click', () => openParticipantEditor());
  document.querySelector('#edit-participant').addEventListener('click', () => openParticipantEditor(currentParticipant));
  editorForm.addEventListener('submit', async event => {
    event.preventDefault(); validateEditorContact(); validateEditorBirthdate(); if (!editorForm.reportValidity()) return;
    if (regionLevels.some(name => !editorForm.elements[name + '_id'].value)) { showAlert(document.querySelector('#editor-alert'), 'Pilih wilayah lengkap dari provinsi sampai desa.'); return; }
    const button = document.querySelector('#editor-save'); button.disabled = true;
    let unlock = () => {};
    try {
      const submittingParticipant = editingParticipant;
      const data = new FormData(editorForm);
      for (const name of regionLevels) { const field = editorForm.elements[name + '_id']; data.set(name + '_nama', field.options[field.selectedIndex]?.textContent || ''); }
      for (const key of ['konfirmasi_data', 'konfirmasi_bukti_transfer', 'konfirmasi_ketentuan_biaya']) data.set(key, 'true');
      const file = editorForm.elements.bukti_transfer.files[0];
      if (!file || !file.size) data.delete('bukti_transfer');
      else if (file.size > 5 * 1024 * 1024) throw new Error('Ukuran bukti transfer maksimal 5 MB.');
      if (submittingParticipant) data.set('version', String(submittingParticipant.version));
      unlock = lockDialogForm(editorForm);
      const result = await api('/api/admin/waitinglist' + (submittingParticipant ? '/' + submittingParticipant.id : ''), { method: submittingParticipant ? 'PUT' : 'POST', body: data });
      const id = submittingParticipant?.id || result.id; editor.close();
      await showParticipantDetail(id); loadRows(); loadReport(); loadFilterOptions();
      showAlert(dashboardAlert, 'Data pendaftar berhasil disimpan.', 'success');
    } catch (error) { showAlert(document.querySelector('#editor-alert'), error.message); }
    finally { unlock(); button.disabled = false; }
  });

  let editingUser = null, resettingUser = null, usersRequestId = 0;
  const userForm = document.querySelector('#user-form');
  async function loadUsers() {
    if (staffUser.role !== 'admin') return; const requestId = ++usersRequestId;
    const container = document.querySelector('#users-rows'); container.replaceChildren();
    showAlert(document.querySelector('#users-alert'), 'Memuat akun petugas…', 'info');
    try {
      const result = await api('/api/admin/users'); if (requestId !== usersRequestId || dashboard.hidden) return;
      showAlert(document.querySelector('#users-alert'), '');
      for (const user of result.users) {
        const tr = document.createElement('tr'); tr.append(makeCell(`${user.name} (${user.username})`), makeCell(user.role === 'admin' ? 'Admin' : 'Bendahara'), makeCell(user.active ? (user.mustChangePassword ? 'Aktif · wajib ganti password' : 'Aktif') : 'Nonaktif'));
        const actions = document.createElement('td'); actions.className = 'user-actions';
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'button button-outline'; edit.textContent = 'Ubah'; edit.addEventListener('click', () => openUser(user));
        const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'button button-outline'; reset.textContent = 'Reset password'; reset.addEventListener('click', () => {
          resettingUser = user; document.querySelector('#reset-password-form').reset(); showAlert(document.querySelector('#reset-password-alert'), '');
          document.querySelector('#reset-password-name').textContent = `${user.name} (${user.username}) wajib mengganti password saat login berikutnya.`; document.querySelector('#reset-password-dialog').showModal();
        });
        actions.append(edit, reset); tr.append(actions); container.append(tr);
      }
    } catch (error) { if (requestId === usersRequestId && !dashboard.hidden) showAlert(document.querySelector('#users-alert'), error.message); }
  }
  function openUser(user = null) {
    editingUser = user; userForm.reset();
    userForm.elements.name.value = user?.name || ''; userForm.elements.username.value = user?.username || ''; userForm.elements.username.disabled = Boolean(user);
    userForm.elements.role.value = user?.role || 'bendahara'; userForm.elements.active.checked = user ? user.active : true;
    userForm.elements.password.required = !user; document.querySelector('#user-password-field').hidden = Boolean(user);
    showAlert(document.querySelector('#user-alert'), ''); document.querySelector('#user-dialog').showModal();
  }
  document.querySelector('#add-user').addEventListener('click', () => openUser());
  userForm.addEventListener('submit', async event => {
    event.preventDefault(); if (!userForm.reportValidity()) return;
    const button = userForm.querySelector('button[type="submit"]'); button.disabled = true;
    let unlock = () => {};
    try {
      const payload = { name: userForm.elements.name.value, role: userForm.elements.role.value };
      if (editingUser) { payload.active = userForm.elements.active.checked; payload.version = editingUser.version; }
      else { payload.username = userForm.elements.username.value; payload.password = userForm.elements.password.value; payload.active = userForm.elements.active.checked; }
      unlock = lockDialogForm(userForm);
      await api('/api/admin/users' + (editingUser ? '/' + editingUser.id : ''), { method: editingUser ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      document.querySelector('#user-dialog').close();
      if (editingUser?.id === staffUser.id) expireSession(); else loadUsers();
    } catch (error) { showAlert(document.querySelector('#user-alert'), error.message); }
    finally { unlock(); button.disabled = false; }
  });
  document.querySelector('#reset-password-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    const password = form.elements.password.value;
    const unlock = lockDialogForm(form);
    try {
      await api(`/api/admin/users/${resettingUser.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password, version: resettingUser.version }) });
      document.querySelector('#reset-password-dialog').close(); form.reset();
      if (resettingUser.id === staffUser.id) expireSession(); else loadUsers();
    } catch (error) { showAlert(document.querySelector('#reset-password-alert'), error.message); }
    finally { unlock(); button.disabled = false; }
  });
  function openPasswordDialog() {
    document.querySelector('#password-form').reset(); showAlert(document.querySelector('#password-alert'), '');
    document.querySelector('#close-password').hidden = staffUser.mustChangePassword;
    document.querySelector('#password-note').textContent = staffUser.mustChangePassword ? 'Ganti password awal/sementara sebelum mengakses dashboard. Setelah disimpan, silakan login kembali.' : 'Sesi akan diakhiri setelah password diganti. Silakan login kembali.';
    document.querySelector('#password-dialog').showModal();
  }
  document.querySelector('#change-password-button').addEventListener('click', openPasswordDialog);
  document.querySelector('#password-dialog').addEventListener('cancel', event => { if (staffUser.mustChangePassword) event.preventDefault(); });
  document.querySelector('#password-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
    if (form.elements.password.value !== form.elements.confirmation.value) { showAlert(document.querySelector('#password-alert'), 'Pengulangan password belum cocok.'); return; }
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    const payload = { currentPassword: form.elements.currentPassword.value, password: form.elements.password.value };
    const unlock = lockDialogForm(form);
    try {
      await api('/api/admin/password', { method: 'POST', body: JSON.stringify(payload) });
      form.reset(); document.querySelector('#password-dialog').close();
      dashboard.hidden = false; expireSession(); showAlert(loginAlert, 'Password berhasil diubah. Silakan login dengan password baru.', 'success');
    } catch (error) { showAlert(document.querySelector('#password-alert'), error.message); }
    finally { unlock(); button.disabled = false; }
  });

  restoreSession();
})();
