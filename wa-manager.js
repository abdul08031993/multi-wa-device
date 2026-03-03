const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const db = require('./db');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const activeSessions = new Map();

/**
 * Fungsi untuk membuat sesi WhatsApp baru
 */
const createSession = async (userId, sessionName, io) => {
    // 1. Sanitasi ID Sesi agar aman untuk nama folder
    const clientId = `${userId}_${sessionName}`.replace(/[^a-zA-Z0-9_-]/g, '');
    const sessionDir = path.join(__dirname, 'sessions');

    // 2. FORCE PERMISSION: Pastikan folder sessions ada dan bisa ditulis
    try {
        if (!fs.existsSync(sessionDir)) {
            console.log(`[SYSTEM] Folder ${sessionDir} tidak ditemukan. Membuat baru...`);
            fs.mkdirSync(sessionDir, { recursive: true, mode: 0o777 });
        } else {
            // Paksa izin folder ke 777 jika folder sudah ada (mengatasi mounting Railway)
            fs.chmodSync(sessionDir, 0o777);
        }
    } catch (err) {
        console.error("[SYSTEM ERROR] Gagal mengatur izin folder:", err.message);
    }

    // 3. Cek apakah sesi sudah berjalan
    if (activeSessions.has(clientId)) {
        console.log(`[SYSTEM] Sesi ${clientId} sudah aktif.`);
        io.emit('connection_success', { clientId });
        return;
    }

    console.log(`[SYSTEM] Menyiapkan browser untuk ${clientId}...`);

    // 4. Konfigurasi Client WhatsApp
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: clientId,
            dataPath: sessionDir // Menggunakan path absolut agar lebih stabil
        }),
        puppeteer: {
            headless: true,
            // Argumen krusial untuk Docker & Cloud (Railway/Render)
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process', 
                '--disable-gpu'
            ],
            // Jika Railway menggunakan image Puppeteer resmi, path ini biasanya sudah benar
        }
    });

    // --- EVENT: QR RECEIVED ---
    client.on('qr', async (qr) => {
        console.log(`[QR] Sesi ${clientId} diterima. Mengonversi ke Base64...`);
        try {
            const qrImageUrl = await qrcode.toDataURL(qr);
            io.emit('qr_code', { clientId, qr: qrImageUrl });
            console.log(`[QR] Sesi ${clientId} siap scan.`);
        } catch (err) {
            console.error("[QR ERROR] Gagal generate QR Image:", err);
        }
    });

    // --- EVENT: READY ---
    client.on('ready', async () => {
        const waNumber = client.info.wid.user;
        console.log(`[SUCCESS] Sesi ${clientId} terhubung dengan nomor: ${waNumber}`);
        
        try {
            // Update atau Simpan ke Database
            const existingAccount = await db('WaAccount')
                .where({ userId: parseInt(userId), waNumber: waNumber })
                .first();

            if (existingAccount) {
                await db('WaAccount')
                    .where({ id: existingAccount.id })
                    .update({ 
                        status: 'CONNECTED', 
                        sessionName: sessionName,
                        createdAt: new Date()
                    });
            } else {
                await db('WaAccount').insert({
                    userId: parseInt(userId),
                    waNumber: waNumber,
                    sessionName: sessionName,
                    status: 'CONNECTED',
                    createdAt: new Date()
                });
            }

            activeSessions.set(clientId, client);
            io.emit('connection_success', { clientId, waNumber });
        } catch (err) {
            console.error("[DB ERROR] Gagal update database saat Ready:", err.message);
        }
    });

    // --- EVENT: DISCONNECTED ---
    client.on('disconnected', async (reason) => {
        console.log(`[DISCONNECT] Sesi ${clientId} terputus:`, reason);
        activeSessions.delete(clientId);
        try {
            await db('WaAccount')
                .where({ userId: parseInt(userId), sessionName: sessionName })
                .update({ status: 'DISCONNECTED' });
        } catch (err) {
            console.error("[DB ERROR] Gagal update status disconnect:", err.message);
        }
        io.emit('disconnected', { clientId });
    });

    // --- INITIALIZE ---
    client.initialize().catch(err => {
        console.error("[INIT ERROR] Gagal inisialisasi browser:", err.message);
        // Kirim error ke frontend agar user tahu kenapa QR tidak muncul
        io.emit('init_error', { message: "Gagal membuka browser WhatsApp. Cek log server." });
    });
};

module.exports = { 
    createSession, 
    activeSessions, 
    MessageMedia 
};
