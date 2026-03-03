require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

// 1. IMPORT DATABASE & WA MANAGER
const db = require('./db'); 
const { createSession, activeSessions, MessageMedia } = require('./wa-manager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname))); 

// --- 2. ROUTES VIEW ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// --- 3. AUTHENTICATION API ---
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [userId] = await db('User').insert({
            username,
            password: hashedPassword,
            balance: 0 
        }).returning('id'); // Menambahkan returning untuk PostgreSQL
        res.json({ userId, username, balance: 0 });
    } catch (e) {
        res.status(400).json({ error: "Username sudah digunakan!" });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await db('User').where({ username }).first();
        if (user && await bcrypt.compare(password, user.password)) {
            // Mengirim data yang dibutuhkan dashboard (id, username, balance)
            res.json({ id: user.id, username: user.username, balance: user.balance });
        } else {
            res.status(401).json({ error: "Login gagal! Periksa username/password." });
        }
    } catch (e) {
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 4. DEVICE MANAGEMENT & SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('User connected to socket:', socket.id);

    // Event saat user minta QR Code dari Dashboard
    socket.on('request_qr', async (data) => {
        const { userId, waNumber } = data;
        const sessionName = `session_${waNumber}`;
        console.log(`Mencoba membuat sesi untuk: ${waNumber}`);
        createSession(userId, sessionName, io);
    });
});

// Endpoint Tambah Akun (Sesuai Dashboard Baru)
app.post('/api/user/accounts/add', async (req, res) => {
    const { userId, waNumber } = req.body;
    try {
        const sessionName = `session_${waNumber}`;
        // Simpan ke database jika belum ada
        const existing = await db('WaAccount').where({ userId, waNumber }).first();
        if (!existing) {
            await db('WaAccount').insert({
                userId,
                waNumber,
                sessionName,
                status: 'DISCONNECTED',
                createdAt: new Date()
            });
        }
        res.json({ message: "Nomor berhasil didaftarkan. Silakan klik Scan QR." });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get My Accounts (Sesuai Dashboard Baru)
app.get('/api/user/my-accounts', async (req, res) => {
    const { userId } = req.query;
    try {
        const devices = await db('WaAccount').where({ userId });
        const updatedDevices = devices.map(dev => {
            const clientId = `${userId}_session_${dev.waNumber}`;
            return { 
                id: dev.id,
                waNumber: dev.waNumber,
                sessionName: dev.sessionName,
                status: activeSessions.has(clientId) ? 'CONNECTED' : 'DISCONNECTED'
            };
        });
        res.json(updatedDevices);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 5. WITHDRAW & STATS (USER SIDE) ---

// Get Stats (Sesuai Dashboard Baru)
app.get('/api/user/my-stats', async (req, res) => {
    const { userId } = req.query;
    try {
        const user = await db('User').where({ id: userId }).first();
        const totalSent = await db('MessageLog').where({ userId }).count('id as total').first();
        const pendingWd = await db('Withdraw').where({ userId, status: 'PENDING' }).sum('amount as total').first();
        const totalEarned = await db('MessageLog').where({ userId, status: 'SENT' }).sum('price as total').first();
        const accountsCount = await db('WaAccount').where({ userId }).count('id as total').first();

        // Cari sesi yang aktif
        let connectedCount = 0;
        for (let clientId of activeSessions.keys()) {
            if (clientId.startsWith(`${userId}_`)) connectedCount++;
        }

        res.json({ 
            balance: user ? user.balance : 0,
            totalSent: parseInt(totalSent.total) || 0,
            pendingWd: parseInt(pendingWd.total) || 0,
            totalEarned: parseInt(totalEarned.total) || 0,
            totalAccounts: parseInt(accountsCount.total) || 0,
            connectedCount: connectedCount
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/user/withdraw', async (req, res) => {
    const { userId, amount, bankInfo } = req.body;
    try {
        const user = await db('User').where({ id: userId }).first();
        if (!user || user.balance < amount) return res.status(400).json({ error: "Saldo tidak cukup!" });

        await db.transaction(async (trx) => {
            await trx('User').where({ id: userId }).decrement('balance', amount);
            await trx('Withdraw').insert({
                userId, amount, bankInfo, status: 'PENDING', createdAt: new Date()
            });
        });
        res.json({ message: "Permintaan WD diajukan! Saldo Anda telah dikurangi." });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 6. ADMIN API ---

app.get('/api/admin/online-sessions', async (req, res) => {
    try {
        let onlineList = [];
        for (let [clientId, client] of activeSessions.entries()) {
            const [uId, sName] = clientId.split('_');
            const user = await db('User').where({ id: uId }).first();
            onlineList.push({
                clientId,
                username: user ? user.username : 'Unknown',
                sessionName: sName,
                waNumber: client.info?.wid?.user || 'Connecting...'
            });
        }
        res.json(onlineList);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/send-message-admin', async (req, res) => {
    const { clientId, receiver, message, imageUrl } = req.body;
    const client = activeSessions.get(clientId);
    const userId = clientId.split('_')[0];

    if (!client) return res.status(404).json({ error: "Sesi Offline" });

    try {
        const formatted = `${receiver.replace(/\D/g, '')}@c.us`;
        if (imageUrl) {
            const media = await MessageMedia.fromUrl(imageUrl);
            await client.sendMessage(formatted, media, { caption: message });
        } else {
            await client.sendMessage(formatted, message);
        }

        const reward = 200; 
        await db.transaction(async (trx) => {
            await trx('User').where({ id: userId }).increment('balance', reward);
            await trx('MessageLog').insert({
                userId: userId, recipient: receiver, price: reward, status: 'SENT', createdAt: new Date()
            });
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- RUN SERVER ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\x1b[32m[SERVER]\x1b[0m Berjalan di http://localhost:${PORT}`);
});
