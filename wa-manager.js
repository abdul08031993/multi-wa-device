const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const db = require('./db');
const activeSessions = new Map();

/**
 * @param {string} userId - ID User dari database (misal: 1)
 * @param {string} sessionName - Nama sesi pilihan user (misal: 'kantor')
 */
const createSession = (userId, sessionName, io) => {
    // Buat ID unik untuk folder session: "1_kantor"
    const clientId = `${userId}_${sessionName}`.replace(/[^a-zA-Z0-9_-]/g, '');

    if (activeSessions.has(clientId)) {
        console.log(`[SYSTEM] Sesi ${clientId} sudah aktif.`);
        io.emit('ready', { clientId });
        return;
    }

    console.log(`[SYSTEM] Menyiapkan browser untuk sesi: ${clientId}`);

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: clientId,
            dataPath: './sessions' // Semua sesi masuk ke folder ./sessions/session-1_kantor
        }),
        puppeteer: {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Menghindari crash di VPS/Linux RAM kecil
        '--disable-gpu'
    ]
}
    });

    client.on('qr', (qr) => {
        console.log(`[QR] Sesi ${clientId} silakan scan.`);
        io.emit('qr', { clientId, qr });
    });

    client.on('ready', async () => {
        const waNumber = client.info.wid.user;
        try {
            // Simpan ke database menggunakan Knex
            // userId di sini adalah ID User asli (angka) agar Foreign Key valid
            await db('WaAccount')
                .insert({
                    userId: parseInt(userId),
                    waNumber: waNumber,
                    status: 'CONNECTED'
                })
                .onConflict('waNumber')
                .merge();

            activeSessions.set(clientId, client);
            io.emit('ready', { clientId, waNumber });
            console.log(`[SUCCESS] Sesi ${clientId} terhubung dengan nomor ${waNumber}`);
        } catch (err) {
            console.error("[DB ERROR]", err.message);
        }
    });

    client.on('disconnected', () => {
        activeSessions.delete(clientId);
        io.emit('disconnected', { clientId });
    });

    client.initialize().catch(err => console.error("[INIT ERROR]", err.message));
};

module.exports = { 
    createSession, 
    activeSessions, 
    MessageMedia: require('whatsapp-web.js').MessageMedia // Ini penting!
};