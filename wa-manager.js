const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const db = require('./db');
const qrcode = require('qrcode'); // Tambahkan ini (install: npm install qrcode)
const activeSessions = new Map();

const createSession = (userId, sessionName, io) => {
    // ID Unik untuk folder & tracking
    const clientId = `${userId}_${sessionName}`.replace(/[^a-zA-Z0-9_-]/g, '');

    if (activeSessions.has(clientId)) {
        console.log(`[SYSTEM] Sesi ${clientId} sudah aktif.`);
        io.emit('connection_success', { clientId });
        return;
    }

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: clientId,
            dataPath: './sessions'
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        }
    });

    // KIRIM QR KE DASHBOARD
    client.on('qr', async (qr) => {
        console.log(`[QR] Sesi ${clientId} siap scan.`);
        try {
            // Ubah text QR menjadi Base64 Image agar tag <img> bisa baca
            const qrImageUrl = await qrcode.toDataURL(qr);
            // Nama event 'qr_code' harus sama dengan yang ada di index.html
            io.emit('qr_code', { clientId, qr: qrImageUrl });
        } catch (err) {
            console.error("Gagal generate QR Image", err);
        }
    });

    client.on('ready', async () => {
        const waNumber = client.info.wid.user;
        try {
            await db('WaAccount')
                .insert({
                    userId: parseInt(userId),
                    waNumber: waNumber,
                    sessionName: sessionName,
                    status: 'CONNECTED',
                    createdAt: new Date()
                })
                .onConflict('waNumber')
                .merge();

            activeSessions.set(clientId, client);
            // Nama event 'connection_success' harus sama dengan index.html
            io.emit('connection_success', { clientId, waNumber });
            console.log(`[SUCCESS] ${clientId} Terhubung!`);
        } catch (err) {
            console.error("[DB ERROR]", err.message);
        }
    });

    client.on('disconnected', async () => {
        activeSessions.delete(clientId);
        await db('WaAccount').where({ userId, sessionName }).update({ status: 'DISCONNECTED' });
        io.emit('disconnected', { clientId });
    });

    client.initialize().catch(err => console.error("[INIT ERROR]", err.message));
};

module.exports = { 
    createSession, 
    activeSessions, 
    MessageMedia 
};
