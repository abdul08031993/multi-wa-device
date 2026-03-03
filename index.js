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

// Update: Konfigurasi Socket.io yang lebih kuat untuk lingkungan Cloud/Docker
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'] // Memastikan koneksi stabil
});

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
        // Fix: Menggunakan .returning('*') untuk mendapatkan objek user lengkap di PostgreSQL
        const [newUser] = await db('User').insert({
            username,
            password: hashedPassword,
            balance: 0 
        }).returning(['id', 'username', 'balance']);
        
        res.json({ userId: newUser.id, username: newUser.username, balance: newUser.balance });
    } catch (e) {
        console.error("Register Error:", e);
        res.status(400).json({ error: "Username sudah digunakan atau masalah database!" });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await db('User').where({ username }).first();
        if (user && await bcrypt.compare(password, user.password)) {
            res.json({ id: user.id, username: user.username, balance: user.balance });
        } else {
            res.status(401).json({ error: "Username atau password salah!" });
        }
    } catch (e) {
        console.error("Login Error:", e);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// --- 4. DEVICE MANAGEMENT & SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('User connected to socket:', socket.id);

    socket.on('request_qr', (data) => {
        const { userId, waNumber } = data;
        if (!userId || !waNumber) return;
        
        const sessionName = `session_${waNumber}`;
        console.log(`[SOCKET] Request QR untuk: ${waNumber}`);
        createSession(userId, sessionName, io);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected from socket');
    });
});

app.post('/api/user/accounts/add', async (req, res) => {
    const { userId, waNumber } = req.body;
    if (!userId || !waNumber) return res.status(400).json({ error: "Data tidak lengkap!" });

    try {
        const sessionName = `session_${waNumber}`;
        const existing = await db('WaAccount').where({ userId, waNumber }).first();
        
        if (!existing) {
            await db('WaAccount').insert({
                userId: parseInt(userId),
                waNumber,
                sessionName,
                status: 'DISCONNECTED',
                createdAt: new Date()
            });
        }
        res.json({ success: true, message: "Nomor terdaftar. Klik Scan QR sekarang." });
    } catch (e) {
        console.error("Add Account Error:", e);
        res.status(500).json({ error: "Gagal menyimpan ke database." });
    }
});

app.get('/api/user/my-accounts', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "User ID missing" });

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
    } catch (e) { res.status(500).json({ error: "Gagal mengambil data akun." }); }
});

// --- 5. WITHDRAW & STATS (USER SIDE) ---

app.get('/api/user/my-stats', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "User ID missing" });

    try {
        // Fix: Memberikan nilai fallback agar tidak error 500 jika data kosong
        const user = await db('User').where({ id: userId }).first() || { balance: 0 };
        const totalSent = await db('MessageLog').where({ userId }).count('id as total').first();
        const pendingWd = await db('Withdraw').where({ userId, status: 'PENDING' }).sum('amount as total').first();
        const totalEarned = await db('MessageLog').where({ userId, status: 'SENT' }).sum('price as total').first();
        const accountsCount = await db('WaAccount').where({ userId }).count('id as total').first();

        let connectedCount = 0;
        for (let clientId of activeSessions.keys()) {
            if (clientId.startsWith(`${userId}_`)) connectedCount++;
        }

        res.json({ 
            balance: user.balance,
            totalSent: parseInt(totalSent?.total) || 0,
            pendingWd: parseInt(pendingWd?.total) || 0,
            totalEarned: parseInt(totalEarned?.total) || 0,
            totalAccounts: parseInt(accountsCount?.total) || 0,
            connectedCount: connectedCount
        });
    } catch (e) { 
        console.error("Stats API Error:", e);
        res.status(500).json({ error: "Database error saat mengambil statistik." }); 
    }
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
        res.json({ message: "Permintaan WD diproses!" });
    } catch (e) { res.status(500).json({ error: "Gagal memproses penarikan." }); }
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
    } catch (e) { res.status(500).json({ error: "Gagal mengambil data admin." }); }
});

app.post('/send-message-admin', async (req, res) => {
    const { clientId, receiver, message, imageUrl } = req.body;
    const client = activeSessions.get(clientId);
    if (!client) return res.status(404).json({ error: "Sesi Offline" });

    try {
        const userId = clientId.split('_')[0];
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
