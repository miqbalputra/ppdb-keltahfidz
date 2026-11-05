(() => {
  const statusBox = document.querySelector("#email-status");
  const groupLink = document.querySelector("#group-link");
  const groupUnavailable = document.querySelector("#group-unavailable");
  const kicker = document.querySelector("#success-kicker");
  const heading = document.querySelector("#success-heading");
  const copy = document.querySelector("#success-copy");
  const icon = document.querySelector("#success-icon-mark");
  let result = null;
  try {
    result = JSON.parse(sessionStorage.getItem("psb_waitinglist_result") || "null");
  } catch {
    result = null;
  }

  if (!result || typeof result.id !== "string" || !result.id) {
    document.title = "Konfirmasi belum tersedia — SPSB 2027";
    kicker.textContent = "KONFIRMASI BELUM TERSEDIA";
    heading.textContent = "Belum ada konfirmasi.";
    copy.textContent = "Halaman ini belum menerima bukti pengiriman dari formulir. Jika Anda baru saja mengirim data, kembali ke halaman utama dan periksa apakah ada pesan kesalahan.";
    statusBox.textContent = "Tidak ada konfirmasi pendaftaran pada sesi ini.";
    statusBox.classList.add("email-warning");
    icon.textContent = "i";
    document.querySelector(".success-icon").classList.add("success-icon-info");
    groupLink.hidden = true;
    groupUnavailable.hidden = true;
    return;
  }

  function showEmailStatus(symbol, message, warning = false) {
    const iconNode = document.createElement("span");
    iconNode.className = "email-status-icon";
    iconNode.setAttribute("aria-hidden", "true");
    iconNode.textContent = symbol;
    const messageNode = document.createElement("span");
    messageNode.textContent = message;
    statusBox.replaceChildren(iconNode, messageNode);
    statusBox.classList.toggle("email-warning", warning);
  }

  const receivedMessage = result.jalurPendaftaran === "askar"
    ? "Pendaftaran melalui Jalur Asatidz dan Karyawan (Askar) Tunas Ilmu berhasil diterima."
    : "Pendaftaran berhasil diterima panitia SPSB 2027.";
  const emailStatus = result?.emailStatus;
  const verificationStatus = result?.paymentVerificationStatus;
  const verificationMessage = verificationStatus === "queued"
    ? "Bukti pembayaran sedang diperiksa otomatis. Jika nominalnya sesuai Rp150.000, invoice akan dikirim ke email."
    : verificationStatus === "not_configured"
      ? "Pemeriksaan bukti otomatis belum diaktifkan; panitia perlu memeriksa pembayaran secara manual."
      : "Pemeriksaan bukti belum terjadwal; panitia akan menindaklanjutinya secara manual.";
  if (emailStatus === "queued") {
    showEmailStatus("✉", `${receivedMessage} Email konfirmasi sedang diproses. ${verificationMessage}`);
  } else if (emailStatus === "failed") {
    showEmailStatus("!", `${receivedMessage} Pemberitahuan email pendaftaran belum terkirim. ${verificationMessage}`, true);
  } else {
    showEmailStatus("✉", `${receivedMessage} Pemberitahuan email belum tersedia; simpan nomor pendaftaran ini: ${result.id}. ${verificationMessage}`, true);
  }

  fetch("/api/config")
    .then((response) => {
      if (!response.ok) throw new Error("Pengaturan belum tersedia.");
      return response.json();
    })
    .then((config) => {
      if (config.whatsappGroupUrl) {
        groupLink.href = config.whatsappGroupUrl;
        groupLink.querySelector("span").textContent = "Masuk Group SPSB Gelombang 1";
        groupLink.hidden = false;
      } else {
        groupUnavailable.hidden = false;
      }
    })
    .catch(() => { groupUnavailable.hidden = false; });
})();
