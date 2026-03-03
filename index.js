require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

// 1. IMPORT DATABASE & WA MANAGER (Hanya sekali di sini)
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
        });
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
            res.json({ userId: user.id, username: user.username, balance: user.balance });
        } else {
            res.status(401).json({ error: "Login gagal!" });
        }
    } catch (e) {
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 4. DEVICE MANAGEMENT (USER SIDE) ---
app.post('/add-device', (req, res) => {
    const { userId, sessionName } = req.body;
    if (!userId || !sessionName) return res.status(400).json({ error: "Data tidak lengkap" });
    createSession(userId, sessionName, io);
    res.json({ message: "Menghubungkan ke WhatsApp..." });
});

app.get('/api/my-devices/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const devices = await db('WaAccount').where({ userId });
        const updatedDevices = devices.map(dev => {
            const clientId = `${userId}_${dev.sessionName}`;
            return { ...dev, is_active: activeSessions.has(clientId) };
        });
        res.json(updatedDevices);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 5. WITHDRAW & STATS (USER SIDE) ---
app.get('/api/stats/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const totalSent = await db('MessageLog').where({ userId }).count('id as total');
        const user = await db('User').where({ id: userId }).first();
        res.json({ total_sent: totalSent[0].total, balance: user ? user.balance : 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/withdraw', async (req, res) => {
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
        res.json({ success: true, message: "Permintaan WD diajukan!" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 6. ADMIN BLAST & MANAGEMENT ENGINE ---

// Ambil semua sesi yang sedang ONLINE
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

// Admin Blast dengan Dukungan Gambar & Reward User
app.post('/send-message-admin', async (req, res) => {
    const { clientId, receiver, message, imageUrl } = req.body;
    const client = activeSessions.get(clientId);
    const [userId] = clientId.split('_');

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
                userId: userId,
                recipient: receiver,
                price: reward,
                status: 'SENT',
                createdAt: new Date()
            });
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Data Semua User & Total Pesan untuk Admin
app.get('/api/admin/users-full', async (req, res) => {
    try {
        const users = await db('User').select('id', 'username', 'balance');
        const results = await Promise.all(users.map(async (u) => {
            const count = await db('MessageLog').where({ userId: u.id }).count('id as total');
            return { ...u, total_sent: count[0].total };
        }));
        res.json(results);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// List Withdraw untuk Admin
app.get('/api/admin/withdraws', async (req, res) => {
    try {
        const wds = await db('Withdraw')
            .join('User', 'Withdraw.userId', '=', 'User.id')
            .select('Withdraw.*', 'User.username')
            .orderBy('Withdraw.createdAt', 'desc');
        res.json(wds);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Approve Withdraw
app.post('/api/admin/approve-wd/:id', async (req, res) => {
    try {
        await db('Withdraw').where({ id: req.params.id }).update({ status: 'SUCCESS' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// RUN SERVER
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\x1b[32m[SERVER]\x1b[0m Berjalan di http://localhost:${PORT}`);
});