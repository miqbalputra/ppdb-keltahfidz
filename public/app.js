(() => {
  const form = document.querySelector("#waitinglist-form");
  if (!form) return;

  const alertBox = document.querySelector("#form-alert");
  const validationSummary = document.querySelector("#validation-summary");
  const validationSummaryTitle = document.querySelector("#validation-summary-title");
  const validationSummaryList = document.querySelector("#validation-summary-list");
  const submitButton = document.querySelector("#submit-button");
  const birthdateInput = form.elements.tanggal_lahir_anak;
  const ageHint = document.querySelector("#age-hint");
  const eligibilityMessage = document.querySelector("#eligibility-message");
  const phoneInput = form.elements.no_hp_wa;
  const phonePreview = document.querySelector("#phone-preview");
  const paymentProofInput = form.elements.bukti_transfer;
  const paymentProofFilename = document.querySelector("#bukti-transfer-filename");
  const regionSelects = [...form.querySelectorAll("select[data-region]")];
  let config = null;
  let turnstileToken = "";
  let turnstileWidgetId = null;
  let turnstileState = "not_required";
  let submitting = false;
  let validationAttempted = false;
  let cutoffDateLabel = "tanggal acuan";
  let countdownTimer = null;
  let formInitialized = false;
  const regionRequests = new Map();
  const fieldErrors = new Map([...form.querySelectorAll("[data-error-for]")]
    .map((element) => [element.dataset.errorFor, element]));
  const fieldLabels = {
    nama_ortu: "Nama orang tua",
    status_ortu: "Status sebagai orang tua",
    nama_anak: "Nama lengkap Ananda",
    jenis_kelamin: "Jenis kelamin Ananda",
    tanggal_lahir_anak: "Tanggal lahir Ananda",
    sekolah_asal: "Sekolah asal",
    provinsi: "Provinsi",
    kabupaten: "Kabupaten / Kota",
    kecamatan: "Kecamatan",
    desa: "Desa / Kelurahan",
    no_hp_wa: "Nomor WhatsApp",
    email: "Email orang tua",
    konfirmasi_bukti_transfer: "Konfirmasi bukti transfer",
    bukti_transfer: "Bukti transfer",
    konfirmasi_data: "Konfirmasi data",
    konfirmasi_ketentuan_biaya: "Persetujuan ketentuan biaya pendaftaran",
  };

  const regionLevels = ["provinces", "regencies", "districts", "villages"];
  const labels = {
    provinces: "Pilih provinsi",
    regencies: "Pilih kabupaten/kota",
    districts: "Pilih kecamatan",
    villages: "Pilih desa/kelurahan",
  };

  function setAlert(message, type = "error") {
    alertBox.textContent = message;
    alertBox.className = `form-alert ${type}`;
    alertBox.hidden = !message;
  }

  function monthAge(birthdate, reference) {
    const [by, bm, bd] = birthdate.split("-").map(Number);
    const [ry, rm, rd] = reference.split("-").map(Number);
    let months = (ry - by) * 12 + rm - bm;
    if (rd < bd) months -= 1;
    return Math.max(months, 0);
  }

  function addCalendarYears(value, years) {
    const [year, month, day] = value.split("-").map(Number);
    const targetYear = year + years;
    const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
    const targetDay = Math.min(day, lastDay);
    return `${targetYear}-${String(month).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
  }

  function nextEligibleCohort(birthdate) {
    const requiredMonths = config.minAgeYears * 12 + config.minAgeMonths;
    for (let yearsAway = 1; yearsAway <= 100; yearsAway += 1) {
      const cutoffDate = addCalendarYears(config.cutoffDate, yearsAway);
      if (monthAge(birthdate, cutoffDate) >= requiredMonths) {
        return { year: Number(cutoffDate.slice(0, 4)), yearsAway };
      }
    }
    return null;
  }

  function eligibilityRetryMessage(birthdate) {
    const cohort = nextEligibleCohort(birthdate);
    if (!cohort) return "Umur Ananda belum memenuhi batas usia. Silakan hubungi panitia untuk informasi pendaftaran berikutnya.";
    const currentYear = config.cutoffDate.slice(0, 4);
    return `Mohon maaf umur Ananda belum masuk kriteria SPSB ${currentYear}. Ananda dapat mendaftar kembali pada SPSB ${cohort.year}, sekitar ${cohort.yearsAway} tahun lagi.`;
  }

  function formatDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("id-ID", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }

  function updateEligibility() {
    const value = birthdateInput.value;
    if (!config || !value) {
      birthdateInput.setCustomValidity("");
      ageHint.textContent = `Umur akan dihitung pada ${cutoffDateLabel}.`;
      eligibilityMessage.hidden = true;
      eligibilityMessage.textContent = "";
      updateSubmitState();
      return;
    }
    const isIneligible = value > config.eligibleBirthdate;
    const retryMessage = isIneligible ? eligibilityRetryMessage(value) : "";
    birthdateInput.setCustomValidity(retryMessage);
    const months = monthAge(value, config.cutoffDate);
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    const ageText = `${years} tahun${remainingMonths ? ` ${remainingMonths} bulan` : ""}`;
    ageHint.textContent = `Umur Ananda pada ${cutoffDateLabel}: ${ageText}.`;
    if (isIneligible) {
      eligibilityMessage.textContent = retryMessage;
      eligibilityMessage.className = "eligibility-message ineligible";
      eligibilityMessage.hidden = false;
    } else {
      eligibilityMessage.textContent = "Alhamdulillah, usia Ananda memenuhi kriteria SPSB 2027.";
      eligibilityMessage.className = "eligibility-message eligible";
      eligibilityMessage.hidden = false;
    }
    updateSubmitState();
  }

  function updateNameValidity() {
    for (const input of [form.elements.nama_ortu, form.elements.nama_anak]) {
      input.setCustomValidity(input.value && !input.value.trim()
        ? "Nama tidak boleh hanya berisi spasi."
        : "");
    }
  }

  function normalizedPreview(raw) {
    let value = raw.replace(/[^0-9+]/g, "");
    if (value.startsWith("+62")) value = value.slice(1);
    else if (value.startsWith("0")) value = `62${value.slice(1)}`;
    if (/^628\d{8,12}$/.test(value)) return `→ ${value}`;
    return "Nomor akan disimpan dengan awalan 62.";
  }

  function updatePhone() {
    phonePreview.textContent = normalizedPreview(phoneInput.value);
    phonePreview.classList.toggle("preview-valid", phonePreview.textContent.startsWith("→"));
    phoneInput.setCustomValidity(phoneInput.value.trim() && !validPhone()
      ? "Masukkan nomor WhatsApp Indonesia yang valid, misalnya 081234567890."
      : "");
    updateSubmitState();
  }

  function updatePaymentProof() {
    const file = paymentProofInput.files?.[0];
    paymentProofInput.setCustomValidity("");
    paymentProofFilename.textContent = file ? file.name : "Belum ada file yang dipilih.";
    paymentProofInput.closest(".upload-control")?.classList.toggle("has-file", Boolean(file));
    if (!file) return;
    const extension = file.name.toLowerCase().split(".").pop();
    if (file.size > 5 * 1024 * 1024) {
      paymentProofInput.setCustomValidity("Ukuran bukti transfer maksimal 5 MB.");
    } else if (!['jpg', 'jpeg', 'png', 'pdf'].includes(extension)) {
      paymentProofInput.setCustomValidity("Pilih bukti transfer berformat JPG, PNG, atau PDF.");
    }
  }

  function validPhone() {
    let value = phoneInput.value.replace(/[^0-9+]/g, "");
    if (value.startsWith("+62")) value = value.slice(1);
    else if (value.startsWith("0")) value = `62${value.slice(1)}`;
    return /^628\d{8,12}$/.test(value);
  }

  function updateSubmitState() {
    submitButton.disabled = submitting;
    if (validationAttempted) renderFieldErrors();
  }

  function renderFieldErrors() {
    const issues = [];
    for (const [name, errorElement] of fieldErrors) {
      const controls = [...form.querySelectorAll(`[name="${name}"]`)];
      const control = controls[0];
      if (!control) continue;
      const regionIndex = regionSelects.indexOf(control);
      const waitsForParent = regionIndex > 0 && !regionSelects[regionIndex - 1].value;
      const unavailable = controls.some((item) => item.disabled) && !waitsForParent;
      const invalid = unavailable || controls.some((item) => !item.disabled && !item.validity.valid);
      let message = "Periksa kembali data yang dimasukkan.";
      if (unavailable) {
        const isLoading = controls.some((item) => item.getAttribute("aria-busy") === "true");
        message = isLoading
          ? "Data wilayah sedang dimuat. Tunggu sebentar, lalu coba lagi."
          : "Data wilayah belum tersedia. Gunakan tombol coba lagi di bawah.";
      } else if (name === "konfirmasi_data" && invalid) {
        message = "Centang konfirmasi data sebelum melanjutkan.";
      } else if (name === "konfirmasi_bukti_transfer" && invalid) {
        message = "Centang konfirmasi bahwa bukti transfer sudah dikirim.";
      } else if (name === "konfirmasi_ketentuan_biaya" && invalid) {
        message = "Centang persetujuan ketentuan biaya pendaftaran.";
      } else if (control.validity.customError) {
        message = control.validationMessage;
      } else if (control.validity.valueMissing) {
        message = "Bagian ini wajib diisi.";
      } else if (control.type === "email" || control.validity.typeMismatch) {
        message = "Periksa kembali format yang dimasukkan.";
      }
      errorElement.textContent = invalid ? message : "";
      errorElement.hidden = !invalid;
      for (const item of controls) {
        if (invalid) item.setAttribute("aria-invalid", "true");
        else item.removeAttribute("aria-invalid");
      }
      if (name === "bukti_transfer") control.closest(".field")?.classList.toggle("field-invalid", invalid);
      if (invalid) issues.push({ name, control, message });
    }

    const listItems = issues.map(({ name, control, message }) => {
      const item = document.createElement("li");
      if (control.disabled) {
        const label = document.createElement("span");
        label.textContent = fieldLabels[name] || "Data formulir";
        item.append(label);
      } else {
        const link = document.createElement("a");
        link.href = `#${control.id}`;
        link.textContent = fieldLabels[name] || "Data formulir";
        item.append(link);
      }
      const detail = document.createElement("span");
      detail.textContent = ` — ${message}`;
      item.append(detail);
      return item;
    });
    validationSummaryList.replaceChildren(...listItems);
    validationSummaryTitle.textContent = issues.length
      ? `Ada ${issues.length} bagian yang perlu diperiksa:`
      : "Periksa kembali bagian berikut:";
    validationSummary.hidden = issues.length === 0;
  }

  function showInlineSuccess(result) {
    const panel = document.querySelector("#inline-success");
    const message = document.querySelector("#inline-success-message");
    const groupLink = document.querySelector("#inline-group-link");
    message.textContent = result.emailStatus === "sent"
      ? "Pendaftaran diterima panitia. Informasi selanjutnya juga telah dikirim ke email yang didaftarkan."
      : result.emailStatus === "failed"
        ? "Pendaftaran diterima panitia, tetapi email belum terkirim. Gunakan tautan grup di bawah atau pantau kontak yang didaftarkan."
        : "Pendaftaran diterima panitia. Pemberitahuan email belum tersedia; gunakan tautan grup di bawah atau pantau kontak yang didaftarkan.";
    if (result.whatsappGroupUrl) {
      groupLink.href = result.whatsappGroupUrl;
      groupLink.hidden = false;
    }
    document.querySelector(".form-heading").hidden = true;
    alertBox.hidden = true;
    form.hidden = true;
    panel.hidden = false;
    panel.focus();
    panel.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center",
    });
  }

  async function loadRegions(select, level, parentId = "") {
    regionRequests.get(select)?.abort();
    const controller = new AbortController();
    regionRequests.set(select, controller);
    select.disabled = true;
    select.setCustomValidity("");
    select.setAttribute("aria-busy", "true");
    select.replaceChildren(new Option("Memuat…", ""));
    try {
      const suffix = parentId ? `?parent_id=${encodeURIComponent(parentId)}` : "";
      const response = await fetch(`/api/regions/${level}${suffix}`, { signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Wilayah tidak dapat dimuat.");
      if (controller.signal.aborted) return;
      const options = [new Option(labels[level], "")];
      for (const item of result.items) {
        const option = new Option(item.name, item.id);
        option.dataset.name = item.name;
        options.push(option);
      }
      select.replaceChildren(...options);
      select.disabled = false;
      select.setCustomValidity("");
      select.closest(".field").querySelector(".region-retry")?.remove();
      setAlert("");
    } catch (error) {
      if (controller.signal.aborted) return;
      select.replaceChildren(new Option("Wilayah gagal dimuat — coba pilih ulang", ""));
      select.disabled = false;
      select.setCustomValidity("Daftar wilayah belum tersedia. Gunakan tombol coba lagi di bawah.");
      const field = select.closest(".field");
      field.querySelector(".region-retry")?.remove();
      const retryButton = document.createElement("button");
      retryButton.type = "button";
      retryButton.className = "button button-outline region-retry";
      retryButton.textContent = "Coba muat wilayah lagi";
      retryButton.addEventListener("click", () => loadRegions(select, level, parentId));
      field.append(retryButton);
      setAlert(error.message || "Data wilayah belum tersedia. Periksa koneksi lalu muat ulang halaman.");
    } finally {
      if (regionRequests.get(select) === controller) {
        regionRequests.delete(select);
        select.removeAttribute("aria-busy");
      }
    }
    updateSubmitState();
  }

  function resetChildren(levelIndex) {
    for (let index = levelIndex + 1; index < regionSelects.length; index += 1) {
      const select = regionSelects[index];
      regionRequests.get(select)?.abort();
      regionRequests.delete(select);
      select.removeAttribute("aria-busy");
      select.replaceChildren(new Option(`Pilih ${["", "kabupaten/kota", "kecamatan", "desa/kelurahan"][index]} terlebih dahulu`, ""));
      select.disabled = true;
      select.setCustomValidity("");
      select.closest(".field").querySelector(".region-retry")?.remove();
    }
  }

  regionSelects.forEach((select, index) => {
    select.addEventListener("change", async () => {
      resetChildren(index);
      if (index < regionSelects.length - 1 && select.value) {
        const child = regionSelects[index + 1];
        await loadRegions(child, regionLevels[index + 1], select.value);
      }
      updateSubmitState();
    });
  });

  async function initTurnstile() {
    if (!config?.turnstileSiteKey) return;
    const container = document.querySelector("#turnstile-container");
    const status = document.querySelector("#turnstile-status");
    container.hidden = false;
    status.hidden = false;
    status.textContent = "Memuat verifikasi keamanan…";
    turnstileState = "loading";
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        const timeout = setTimeout(() => reject(new Error("Verifikasi keamanan melewati batas waktu.")), 12000);
        script.onload = () => { clearTimeout(timeout); resolve(); };
        script.onerror = () => { clearTimeout(timeout); reject(new Error("Verifikasi keamanan gagal dimuat.")); };
        document.head.append(script);
      });
      if (!window.turnstile) throw new Error("Widget verifikasi tidak tersedia.");
      turnstileWidgetId = window.turnstile.render(container, {
        sitekey: config.turnstileSiteKey,
        callback: (token) => {
          turnstileToken = token;
          turnstileState = "verified";
          status.hidden = true;
          updateSubmitState();
        },
        "expired-callback": () => {
          turnstileToken = "";
          turnstileState = "ready";
          status.textContent = "Verifikasi kedaluwarsa. Selesaikan kembali sebelum mengirim.";
          status.hidden = false;
          updateSubmitState();
        },
        "error-callback": () => {
          turnstileToken = "";
          turnstileState = "error";
          status.textContent = "Verifikasi keamanan bermasalah. Periksa koneksi, lalu muat ulang halaman.";
          status.hidden = false;
          updateSubmitState();
        },
      });
      turnstileState = "ready";
      status.textContent = "Selesaikan verifikasi keamanan sebelum mengirim pendaftaran.";
      updateSubmitState();
    } catch {
      turnstileState = "error";
      status.textContent = "Verifikasi keamanan gagal dimuat. Periksa koneksi dan muat ulang halaman untuk mencoba kembali.";
      status.hidden = false;
      setAlert("Verifikasi keamanan belum tersedia. Formulir tidak dapat dikirim sampai verifikasi berhasil.");
    }
  }

  function openingTime(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
    if (!match) return null;
    const [y, m, d, h, min] = match.slice(1).map(Number);
    // Validate the calendar date in WIB before converting it to UTC. Midnight WIB
    // belongs to the previous UTC day (sometimes the previous month/year).
    const local = new Date(Date.UTC(y, m - 1, d, h, min));
    if (local.getUTCFullYear() !== y || local.getUTCMonth() !== m - 1
      || local.getUTCDate() !== d || local.getUTCHours() !== h || local.getUTCMinutes() !== min) return null;
    return local.getTime() - 7 * 60 * 60 * 1000;
  }

  async function initializeForm() {
    if (formInitialized) return;
    formInitialized = true;
    document.body.classList.remove("countdown-mode");
    document.querySelector("#opening-countdown").hidden = true;
    await loadRegions(regionSelects[0], "provinces");
    await initTurnstile();
    updateSubmitState();
  }

  function showCountdown(timestamp) {
    const panel = document.querySelector("#opening-countdown");
    const schedule = document.querySelector("#countdown-schedule");
    panel.hidden = false;
    document.body.classList.add("countdown-mode");
    if (timestamp === null) {
      document.querySelector("#countdown-clock").hidden = true;
      schedule.textContent = "Jadwal pembukaan belum tersedia. Silakan hubungi panitia.";
      return;
    }
    schedule.textContent = `Pendaftaran dibuka ${new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(timestamp)} WIB`;
    const tick = async () => {
      const remaining = timestamp - Date.now();
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        try {
          const response = await fetch("/api/config", { cache: "no-store" });
          const latestConfig = await response.json();
          if (response.ok && latestConfig.registrationOpen) {
            await initializeForm();
            return;
          }
        } catch {
          // Keep the countdown closed until the server confirms the opening time.
        }
        countdownTimer = setTimeout(tick, 5000);
        return;
      }
      const values = [Math.floor(remaining / 86400000), Math.floor(remaining / 3600000) % 24,
        Math.floor(remaining / 60000) % 60, Math.floor(remaining / 1000) % 60];
      ["days", "hours", "minutes", "seconds"].forEach((unit, index) => {
        document.querySelector(`#countdown-${unit}`).textContent = String(values[index]).padStart(2, "0");
      });
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  async function initialize() {
    try {
      const response = await fetch("/api/config");
      if (!response.ok) throw new Error("Konfigurasi belum dapat dimuat.");
      config = await response.json();
      document.body.classList.remove("config-pending");
      cutoffDateLabel = formatDate(config.cutoffDate);
      birthdateInput.max = new Date().toISOString().slice(0, 10);
      document.querySelector("#cutoff-date-label").textContent = cutoffDateLabel;
      document.querySelector("#minimum-age-label").textContent = `${config.minAgeYears} tahun ${config.minAgeMonths} bulan`;
      document.querySelector("#deadline-label").textContent = formatDate(config.eligibleBirthdate);
      const timestamp = openingTime(config.openingDateTime);
      if (config.openingCountdownEnabled && !config.registrationOpen) {
        showCountdown(timestamp !== null && timestamp > Date.now() ? timestamp : null);
        return;
      }
      await initializeForm();
    } catch {
      document.body.classList.remove("config-pending");
      setAlert("Aplikasi belum dapat dimuat. Muat ulang halaman beberapa saat lagi.");
    }
  }

  birthdateInput.addEventListener("input", updateEligibility);
  birthdateInput.addEventListener("change", updateEligibility);
  phoneInput.addEventListener("input", updatePhone);
  paymentProofInput.addEventListener("change", () => {
    updatePaymentProof();
    updateSubmitState();
  });
  form.elements.nama_ortu.addEventListener("input", updateNameValidity);
  form.elements.nama_anak.addEventListener("input", updateNameValidity);
  form.addEventListener("input", updateSubmitState);
  form.addEventListener("change", updateSubmitState);

  const brochureButton = document.querySelector("#download-brochure");
  const brochureFeedback = document.querySelector("#brochure-feedback");
  brochureButton.addEventListener("click", async () => {
    brochureButton.disabled = true;
    brochureFeedback.hidden = false;
    brochureFeedback.textContent = "Menyiapkan brosur…";
    try {
      // Fetch the file itself rather than trusting an old availability flag: an admin
      // may upload or delete it while this page remains open.
      const response = await fetch("/api/brochure", { cache: "no-store" });
      if (response.status === 404) {
        brochureFeedback.textContent = "Brosur belum tersedia. Silakan hubungi admin untuk informasi.";
        return;
      }
      if (!response.ok) throw new Error("Brosur belum dapat diunduh. Silakan coba lagi.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "brosur-spsb-2027.pdf";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      brochureFeedback.hidden = true;
      brochureFeedback.textContent = "";
    } catch {
      brochureFeedback.textContent = "Brosur belum dapat diunduh. Silakan coba lagi.";
    } finally {
      brochureButton.disabled = false;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setAlert("");
    updateEligibility();
    updatePhone();
    updateNameValidity();
    updatePaymentProof();
    validationAttempted = true;
    renderFieldErrors();
    if (!form.checkValidity() || !validationSummary.hidden) {
      validationSummary.focus();
      validationSummary.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center",
      });
      return;
    }
    if (!config) {
      setAlert("Aplikasi belum selesai dimuat. Periksa koneksi lalu coba lagi.");
      alertBox.focus();
      return;
    }
    if (regionSelects.some((select) => select.disabled)) {
      setAlert("Data wilayah belum tersedia. Periksa koneksi, lalu muat ulang halaman.");
      alertBox.focus();
      return;
    }
    if (config.turnstileSiteKey && !turnstileToken) {
      setAlert(turnstileState === "error"
        ? "Verifikasi keamanan belum berhasil dimuat. Periksa koneksi dan muat ulang halaman untuk mencoba kembali."
        : turnstileState === "loading"
          ? "Verifikasi keamanan masih dimuat. Tunggu sebentar sebelum mengirim formulir."
          : "Selesaikan verifikasi keamanan sebelum mengirim formulir.");
      alertBox.focus();
      document.querySelector("#turnstile-container").focus();
      return;
    }
    const payload = {
      nama_ortu: form.elements.nama_ortu.value.trim(),
      status_ortu: form.querySelector('input[name="status_ortu"]:checked')?.value,
      nama_anak: form.elements.nama_anak.value.trim(),
      jenis_kelamin: form.querySelector('input[name="jenis_kelamin"]:checked')?.value,
      tanggal_lahir_anak: birthdateInput.value,
      sekolah_asal: form.elements.sekolah_asal.value.trim(),
      no_hp_wa: phoneInput.value,
      email: form.elements.email.value.trim(),
      website: form.elements.website.value,
      konfirmasi_data: form.elements.konfirmasi_data.checked,
      konfirmasi_bukti_transfer: form.elements.konfirmasi_bukti_transfer.checked,
      konfirmasi_ketentuan_biaya: form.elements.konfirmasi_ketentuan_biaya.checked,
      turnstile_token: turnstileToken,
    };
    for (const key of ["provinsi", "kabupaten", "kecamatan", "desa"]) {
      const select = form.elements[key];
      payload[`${key}_id`] = select.value;
      payload[`${key}_nama`] = select.selectedOptions[0]?.dataset.name || "";
    }
    submitting = true;
    form.setAttribute("aria-busy", "true");
    submitButton.disabled = true;
    submitButton.querySelector("span:first-child").textContent = "Mengirim data…";
    try {
      const formData = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        formData.append(key, typeof value === "boolean" ? String(value) : String(value ?? ""));
      }
      formData.append("bukti_transfer", paymentProofInput.files[0]);
      const response = await fetch("/api/waitinglist", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Data belum dapat dikirim. Silakan coba kembali.");
      try {
        sessionStorage.setItem("psb_waitinglist_result", JSON.stringify(result));
        window.location.assign("/success");
      } catch {
        showInlineSuccess(result);
      }
    } catch (error) {
      setAlert(error.message || "Koneksi terputus. Periksa koneksi dan coba kembali.");
      alertBox.focus();
      submitting = false;
      form.removeAttribute("aria-busy");
      submitButton.querySelector("span:first-child").textContent = "Kirim pendaftaran";
      updateSubmitState();
      if (turnstileWidgetId !== null && window.turnstile) {
        window.turnstile.reset(turnstileWidgetId);
        turnstileToken = "";
      }
    }
  });

  initialize();
})();
