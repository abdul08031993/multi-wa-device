const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const db = require('./db');
const qrcode = require('qrcode');
const activeSessions = new Map();

const createSession = (userId, sessionName, io) => {
    // Sanitasi clientId agar tidak ada karakter aneh yang merusak path folder
    const clientId = `${userId}_${sessionName}`.replace(/[^a-zA-Z0-9_-]/g, '');

    if (activeSessions.has(clientId)) {
        console.log(`[SYSTEM] Sesi ${clientId} sudah aktif.`);
        io.emit('connection_success', { clientId });
        return;
    }

    console.log(`[SYSTEM] Menyiapkan browser untuk ${clientId}...`);

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: clientId,
            dataPath: './sessions' // Pastikan Dockerfile memberikan izin ke folder ini
        }),
        puppeteer: {
            headless: true,
            // Argumen WAJIB untuk Railway/Docker agar browser tidak crash
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
            // Opsional: Jika menggunakan Docker image khusus, path bisa diarahkan ke:
            // executablePath: '/usr/bin/google-chrome-stable'
        }
    });

    // KIRIM QR KE DASHBOARD
    client.on('qr', async (qr) => {
        console.log(`[QR] Sesi ${clientId} diterima. Mengonversi ke Base64...`);
        try {
            // Mengubah teks QR mentah menjadi Gambar Base64
            const qrImageUrl = await qrcode.toDataURL(qr);
            io.emit('qr_code', { clientId, qr: qrImageUrl });
            console.log(`[QR] Sesi ${clientId} siap scan.`);
        } catch (err) {
            console.error("[QR ERROR] Gagal generate QR Image:", err);
        }
    });

    client.on('ready', async () => {
        const waNumber = client.info.wid.user;
        console.log(`[SUCCESS] Sesi ${clientId} terhubung dengan nomor: ${waNumber}`);
        
        try {
            // Gunakan id (Primary Key) untuk update atau buat baru jika belum ada
            // Sesuai dengan tabel yang kita buat di terminal sebelumnya
            const existingAccount = await db('WaAccount')
                .where({ userId: parseInt(userId), waNumber: waNumber })
                .first();

            if (existingAccount) {
                await db('WaAccount')
                    .where({ id: existingAccount.id })
                    .update({ 
                        status: 'CONNECTED', 
                        sessionName: sessionName 
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
            console.error("[DB ERROR] Gagal simpan sesi ke database:", err.message);
        }
    });

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

    // Inisialisasi dengan catch agar server tidak mati jika browser gagal terbuka
    client.initialize().catch(err => {
        console.error("[INIT ERROR] Puppeteer gagal terbuka:", err.message);
        io.emit('init_error', { message: "Gagal membuka browser WhatsApp." });
    });
};

module.exports = { 
    createSession, 
    activeSessions, 
    MessageMedia 
};
