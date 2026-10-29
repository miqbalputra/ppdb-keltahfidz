import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { chromium } from 'playwright';

// Own the app process and temporary attachment volume; refuse production databases.
const databaseUrl = process.env.TEST_DATABASE_URL;
assert.ok(databaseUrl && /(^|[_-])test([_-]|$)/i.test(decodeURIComponent(new URL(databaseUrl).pathname.slice(1))), 'TEST_DATABASE_URL must name a dedicated database such as waitinglist_test.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'tmp', 'ui-check');
const directory = await mkdtemp(join(tmpdir(), 'spsb-browser-test-'));
const nonce = Date.now().toString(36);
const username = `browser-${nonce}`;
const childName = `Maryam Browser ${nonce}`;
const initialPassword = 'temporary-browser-password-123';
const newPassword = 'changed-browser-password-12345';
const settings = { cutoffDate: '2027-07-01', minAgeYears: 6, minAgeMonths: 6, whatsappGroupUrl: '', openingCountdownEnabled: true, openingDateTime: '2030-01-01T09:00' };
const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
const port = listener.address().port; await new Promise(done => listener.close(done));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.env.BUN_BIN || 'bun', ['src/index.ts'], { cwd: root, windowsHide: true,
  env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: directory,
    ADMIN_USERNAME: 'integration-admin', ADMIN_PASSWORD: 'integration-test-password', APP_SECRET: 'integration-test-session-secret-with-32-chars',
    DATA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', COOKIE_SECURE: 'false', DB_SSL: 'false',
    N8N_WEBHOOK_URL: '', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '', startupError, browser, context, previousSettings, headers;
server.on('error', error => { startupError = error; });
for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { logs = (logs + data).slice(-8000); });
const pause = ms => new Promise(done => setTimeout(done, ms));
const errors = [], participantIds = [], userIds = [];

async function signIn(page, name, password) {
  await page.goto(base + '/admin');
  await page.locator('#login-form [name=username]').fill(name);
  await page.locator('#login-form [name=password]').fill(password);
  await page.locator('#login-form button[type=submit]').click();
}
async function saveSettings(value) {
  const response = await context.request.put(base + '/api/admin/settings', { headers, data: value });
  assert.equal(response.status(), 200, 'Settings must save successfully');
}
async function navigate(page, section) {
  const panels = { ringkasan: 'reports-panel', peserta: 'waitinglist-panel', pembayaran: 'payments-panel', analitik: 'analytics-panel', akun: 'users-panel', pengaturan: 'settings-panel', arsip: 'waitinglist-panel' };
  await page.locator('#' + section).click();
  await page.locator(`#${section}[aria-current="page"]`).waitFor();
  await page.locator('#' + panels[section]).waitFor();
}
async function download(page, selector, extension) {
  const pending = page.waitForEvent('download'); await page.locator(selector).click();
  const file = await pending, path = join(output, `browser-${nonce}-${file.suggestedFilename()}`);
  assert.equal(await file.failure(), null); await file.saveAs(path);
  const bytes = await readFile(path); assert.ok(bytes.length > 10);
  if (extension === 'pdf') assert.equal(bytes.toString('ascii', 0, 4), '%PDF');
  if (extension === 'xlsx') assert.equal(bytes.toString('ascii', 0, 2), 'PK');
}

try {
  await mkdir(output, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (startupError) throw startupError;
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Preview exited during startup: ' + logs);
    try { ready = (await fetch(base + '/healthz')).ok; } catch { /* startup still in progress */ }
    if (ready) break; await pause(200);
  }
  assert.ok(ready, 'App did not become ready: ' + logs);
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await signIn(page, 'integration-admin', 'integration-test-password'); await page.locator('#dashboard').waitFor();
  const me = await (await context.request.get(base + '/api/admin/me')).json();
  headers = { origin: base, 'x-csrf-token': me.csrfToken };
  previousSettings = (await (await context.request.get(base + '/api/admin/system')).json()).settings;
  await saveSettings(settings);
  // Upstream regions have their own service integration tests; UI tests are deterministic offline.
  let regionsAvailable = true;
  await page.route('**/api/regions/**', route => {
    if (!regionsAvailable) return route.fulfill({ status: 503, json: { error: 'Wilayah sementara tidak tersedia.' } });
    const url = route.request().url();
    const items = url.includes('/provinces') ? [{ id: '32', name: 'Jawa Barat' }]
      : url.includes('/regencies') ? [{ id: '32.73', name: 'Kota Bandung' }]
      : url.includes('/districts') ? [{ id: '32.73.01', name: 'Sukasari' }] : [{ id: '32.73.01.1001', name: 'Sukarasa' }];
    return route.fulfill({ json: { items } });
  });
  await navigate(page, 'peserta'); await page.locator('#add-participant').click();
  const form = page.locator('#participant-editor-form');
  for (const [key, value] of Object.entries({ nama_anak: childName, nama_ortu: `Ibu Browser ${nonce}`, tanggal_lahir_anak: '2020-01-01', no_hp_wa: '081234567890', email: 'browser@example.test', sekolah_asal: 'TAUD Pengujian' })) await form.locator(`[name=${key}]`).fill(value);
  await form.locator('[name=status_ortu]').selectOption('ibu'); await form.locator('[name=jenis_kelamin]').selectOption('putri');
  for (const [key, value] of [['provinsi', '32'], ['kabupaten', '32.73'], ['kecamatan', '32.73.01'], ['desa', '32.73.01.1001']]) await form.locator(`[name=${key}_id]`).selectOption(value);
  const proof = { name: 'proof.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nBROWSER FIXTURE\n%%EOF') };
  await form.locator('[name=bukti_transfer]').setInputFiles(proof);
  for (const key of ['konfirmasi_data', 'konfirmasi_bukti_transfer', 'konfirmasi_ketentuan_biaya']) await form.locator(`[name=${key}]`).check();
  await form.locator('button[type=submit]').click(); await page.locator('#participant-dialog-title').filter({ hasText: childName }).waitFor();
  const rows = await (await context.request.get(base + `/api/admin/waitinglist?q=${nonce}&view=all`)).json(); participantIds.push(...rows.rows.map(row => row.id));
  assert.equal(participantIds.length, 1);
  const payment = page.locator('#payment-form');
  await payment.locator('[name=status]').selectOption('verified');
  await payment.locator('[name=date]').fill(new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10));
  await payment.locator('[name=amountConfirmed]').check(); await payment.locator('button[type=submit]').click();
  await page.locator('#payment-current-status').filter({ hasText: 'Terverifikasi' }).waitFor();
  // Changing the province during an older request must leave the new selection savable.
  let releaseCounty, receivedCounty, countyPaused = false;
  const countyReceived = new Promise(done => { receivedCounty = done; });
  const countyHeld = new Promise(done => { releaseCounty = done; });
  const countyRoute = '**/api/regions/regencies?parent_id=32';
  await page.route(countyRoute, async route => {
    if (!countyPaused) { countyPaused = true; receivedCounty(); await countyHeld; }
    await route.fallback();
  });
  await page.locator('#edit-participant').click(); await countyReceived;
  await form.locator('[name=provinsi_id]').selectOption(''); await form.locator('[name=provinsi_id]').selectOption('32');
  for (const [key, value] of [['kabupaten', '32.73'], ['kecamatan', '32.73.01'], ['desa', '32.73.01.1001']]) await form.locator(`[name=${key}_id]`).selectOption(value);
  await page.locator('#editor-save:not([disabled])').waitFor(); releaseCounty(); await page.unroute(countyRoute);
  await form.locator('[name=bukti_transfer]').setInputFiles(proof); await form.locator('[name=reason]').fill('Mengganti bukti untuk pengujian');
  await form.locator('button[type=submit]').click(); await page.locator('#payment-current-status').filter({ hasText: 'Belum diperiksa' }).waitFor();
  await page.locator('#archive-participant-button').click(); await page.locator('#lifecycle-form [name=reason]').fill('Arsip pengujian');
  await page.locator('#lifecycle-form button[type=submit]').click(); await page.locator('#lifecycle-dialog').waitFor({ state: 'hidden' });
  await navigate(page, 'arsip'); await page.getByRole('button', { name: `Lihat detail pendaftaran ${childName}`, exact: true }).click();
  await page.locator('#restore-participant-button').click(); await page.locator('#lifecycle-form [name=reason]').fill('Pulihkan pengujian');
  await page.locator('#lifecycle-form button[type=submit]').click(); await page.locator('#lifecycle-dialog').waitFor({ state: 'hidden' });

  await saveSettings({ ...settings, minAgeYears: 18, minAgeMonths: 0 });
  await page.getByRole('button', { name: `Lihat detail pendaftaran ${childName}`, exact: true }).click(); await page.locator('#edit-participant').click();
  await page.locator('#editor-save:not([disabled])').waitFor();
  assert.equal(await form.locator('[name=tanggal_lahir_anak]').evaluate(field => field.checkValidity()), true);
  await form.locator('[name=tanggal_lahir_anak]').fill('2020-01-02');
  assert.equal(await form.locator('[name=tanggal_lahir_anak]').evaluate(field => field.checkValidity()), false);
  await form.locator('[name=tanggal_lahir_anak]').fill('2020-01-01'); await form.locator('[name=email]').fill('snapshot@example.test'); await form.locator('[name=reason]').fill('Koreksi kontak setelah perubahan aturan usia');
  await form.locator('button[type=submit]').click(); await page.locator('#detail-email').filter({ hasText: 'snapshot@example.test' }).waitFor();
  regionsAvailable = false;
  await page.locator('#edit-participant').click(); await page.locator('#retry-editor-regions').waitFor();
  assert.equal(await form.locator('[name=desa_id]').inputValue(), '32.73.01.1001');
  await form.locator('[name=email]').fill('resilient@example.test'); await form.locator('[name=reason]').fill('Koreksi kontak saat layanan wilayah pulih');
  regionsAvailable = true; await page.locator('#retry-editor-regions').click(); await page.locator('#editor-save:not([disabled])').waitFor();
  assert.equal(await form.locator('[name=email]').inputValue(), 'resilient@example.test');
  let releaseSave, receivedSave;
  const received = new Promise(done => { receivedSave = done; });
  const heldSave = new Promise(done => { releaseSave = done; });
  const participantRoute = `**/api/admin/waitinglist/${participantIds[0]}`;
  await page.route(participantRoute, async route => {
    if (route.request().method() === 'PUT') { receivedSave(); await heldSave; }
    await route.continue();
  });
  await form.locator('button[type=submit]').click(); await received;
  assert.equal(await form.locator('[name=email]').isDisabled(), true);
  assert.equal(await page.locator('[data-close=participant-editor]').isDisabled(), true);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#participant-editor').isVisible(), true);
  releaseSave(); await page.locator('#detail-email').filter({ hasText: 'resilient@example.test' }).waitFor(); await page.unroute(participantRoute);
  await download(page, '#detail-pdf-link', 'pdf'); await download(page, '#detail-xlsx-link', 'xlsx');
  await page.locator('#close-participant-dialog').click(); await saveSettings(settings);

  for (const width of [1786, 1440, 1366, 1200, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const section of ['ringkasan', 'peserta', 'pembayaran', 'analitik', 'akun', 'pengaturan']) {
      await navigate(page, section);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Horizontal overflow in ${section} at ${width}px`);
      if ([1440, 390].includes(width)) await page.screenshot({ path: join(output, `${section}-${width}.png`) });
    }
    await navigate(page, 'ringkasan'); await page.screenshot({ path: join(output, `overview-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.locator('.filter-options summary').click();
  await page.locator('#filter-form [name=payment_status]').selectOption('pending'); await page.locator('#filter-form button[type=submit]').click();
  await page.locator('#filter-options-count').filter({ hasText: '1 aktif' }).waitFor();
  await page.getByRole('button', { name: 'Hapus filter Pembayaran: Belum diperiksa', exact: true }).click();
  await page.locator('#filter-options-count').filter({ hasText: 'Opsional' }).waitFor(); await page.locator('.filter-options summary').click();
  await page.locator('#filter-form [name=q]').fill('constructor'); await page.locator('#filter-form button[type=submit]').click();
  await page.getByRole('button', { name: 'Hapus filter Pencarian: constructor', exact: true }).click();
  for (const [section, selector, extension] of [['peserta', '#export-xlsx-button', 'xlsx'], ['peserta', '#export-participants-pdf', 'pdf'], ['analitik', '#export-report', 'xlsx'], ['analitik', '#export-report-pdf', 'pdf'], ['pembayaran', '#export-payment-xlsx', 'xlsx'], ['pembayaran', '#export-payment-pdf', 'pdf']]) {
    await navigate(page, section); await download(page, selector, extension);
  }
  await navigate(page, 'peserta');
  const sorted = page.waitForResponse(response => response.url().includes('/api/admin/waitinglist?') && response.url().includes('sort=name'));
  await page.locator('[name=sort]').selectOption('name'); assert.equal((await sorted).status(), 200);
  await page.locator('#add-participant').click(); await page.locator('#editor-save:not([disabled])').waitFor(); await form.locator('[name=nama_anak]').fill('Belum disimpan');
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('[data-close=participant-editor]').click(); assert.equal(await page.locator('#participant-editor').isVisible(), true);
  page.once('dialog', dialog => dialog.accept()); await page.locator('[data-close=participant-editor]').click(); await page.locator('#participant-editor').waitFor({ state: 'hidden' });

  await navigate(page, 'akun'); await page.locator('#add-user').click(); const account = page.locator('#user-form');
  await account.locator('[name=name]').fill('Bendahara Browser'); await account.locator('[name=username]').fill(username); await account.locator('[name=password]').fill(initialPassword);
  await account.locator('button[type=submit]').click(); await page.locator('#users-rows').filter({ hasText: username }).waitFor();
  const users = await (await context.request.get(base + '/api/admin/users')).json(); userIds.push(users.users.find(user => user.username === username).id);
  const treasury = await browser.newContext({ viewport: { width: 390, height: 844 } }); const treasurerPage = await treasury.newPage(); treasurerPage.on('pageerror', error => errors.push(error.message));
  await signIn(treasurerPage, username, initialPassword); await treasurerPage.locator('#password-dialog').waitFor();
  await treasurerPage.locator('#password-form [name=currentPassword]').fill(initialPassword); await treasurerPage.locator('#password-form [name=password]').fill(newPassword); await treasurerPage.locator('#password-form [name=confirmation]').fill(newPassword);
  await treasurerPage.locator('#password-form button[type=submit]').click(); await treasurerPage.locator('#password-dialog').waitFor({ state: 'hidden' });
  await signIn(treasurerPage, username, newPassword); await treasurerPage.locator('#payments-panel').waitFor();
  for (const id of ['akun', 'pengaturan', 'add-participant']) assert.equal(await treasurerPage.locator('#' + id).isVisible(), false);
  assert.equal((await treasury.request.get(base + '/api/admin/users')).status(), 403);
  await treasurerPage.goto(base + '/'); await treasurerPage.locator('#opening-countdown').waitFor();
  assert.deepEqual(errors, []); console.log('PASS: CRUD, payments, archive/restore, age snapshots, region recovery, save locks, 48 responsive views, 8 exports, filters, drafts, staff roles and public countdown.');
} finally {
  if (context && headers) {
    if (previousSettings) await saveSettings(previousSettings).catch(() => {});
    const rows = await (await context.request.get(base + `/api/admin/waitinglist?q=${nonce}&view=all`).catch(() => null))?.json().catch(() => null);
    if (rows?.rows) participantIds.push(...rows.rows.map(row => row.id));
    const users = await (await context.request.get(base + '/api/admin/users').catch(() => null))?.json().catch(() => null);
    if (users?.users) userIds.push(...users.users.filter(user => user.username === username).map(user => user.id));
  }
  await browser?.close();
  if (server.pid && server.exitCode === null && server.signalCode === null) { const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; }
  const connection = await mysql.createConnection(databaseUrl);
  try {
    for (const id of new Set([...participantIds, ...userIds])) await connection.execute('DELETE FROM audit_events WHERE subject_id = ?', [id]);
    for (const id of new Set(participantIds)) {
      await connection.execute('DELETE FROM participant_proofs WHERE participant_id = ?', [id]);
      await connection.execute('DELETE FROM calon_santri_waitinglist WHERE id = ?', [id]);
    }
    for (const id of new Set(userIds)) {
      await connection.execute('DELETE FROM staff_sessions WHERE user_id = ?', [id]);
      await connection.execute('DELETE FROM staff_users WHERE id = ?', [id]);
    }
  } finally { await connection.end(); }
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('spsb-browser-test-'));
  await rm(directory, { recursive: true, force: true });
}
