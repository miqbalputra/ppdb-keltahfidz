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

  const emailStatus = result?.emailStatus;
  if (emailStatus === "sent") {
    showEmailStatus("✉", "Informasi bergabung telah diteruskan ke email yang didaftarkan.");
  } else if (emailStatus === "failed") {
    showEmailStatus("!", "Data sudah diterima, tetapi email belum berhasil dikirim. Silakan gunakan tautan grup di bawah ini.", true);
  } else {
    showEmailStatus("✉", "Data sudah diterima. Informasi grup akan dikirim ke email setelah notifikasi diaktifkan.", true);
  }

  fetch("/api/config")
    .then((response) => {
      if (!response.ok) throw new Error("Pengaturan belum tersedia.");
      return response.json();
    })
    .then((config) => {
      if (config.whatsappGroupUrl) {
        groupLink.href = config.whatsappGroupUrl;
        groupLink.hidden = false;
      } else {
        groupUnavailable.hidden = false;
      }
    })
    .catch(() => { groupUnavailable.hidden = false; });
})();
