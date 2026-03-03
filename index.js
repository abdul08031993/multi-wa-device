require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

// IMPORT DATABASE & WA MANAGER
const db = require('./db'); 
const { createSession, activeSessions, MessageMedia } = require('./wa-manager');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling'],
    allowEIO3: true 
});

app.use(express.json());
app.use(express.static(path.join(__dirname))); 

// --- ROUTES VIEW ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// --- SYSTEM SETTINGS (TARIF DINAMIS) ---

// Get current price (Bisa diakses user & admin)
app.get('/api/settings/price', async (req, res) => {
    try {
        let price = await db('Settings').where({ key: 'chat_price' }).first();
        if (!price) {
            // Jika belum ada di DB, buat default 500
            await db('Settings').insert({ key: 'chat_price', value: '500' });
            price = { value: '500' };
        }
        res.json({ price: parseInt(price.value) });
    } catch (e) { res.json({ price: 500 }); }
});

// Update price (Hanya Admin)
app.post('/api/admin/settings/update-price', async (req, res) => {
    const { newPrice } = req.body;
    try {
        await db('Settings').where({ key: 'chat_price' }).update({ value: newPrice.toString() });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Gagal update tarif" }); }
});

// --- AUTHENTICATION API ---
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [newUser] = await db('User').insert({
            username,
            password: hashedPassword,
            balance: 0 
        }).returning(['id', 'username', 'balance']);
        res.json({ userId: newUser.id, username: newUser.username, balance: newUser.balance });
    } catch (e) {
        res.status(400).json({ error: "Username sudah digunakan!" });
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
    } catch (e) { res.status(500).json({ error: "Internal Server Error" }); }
});

// --- DEVICE MANAGEMENT & SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('request_qr', (data) => {
        const { userId, waNumber } = data;
        if (!userId || !waNumber) return;
        createSession(userId, `session_${waNumber}`, io);
    });
});

app.post('/api/user/accounts/add', async (req, res) => {
    const { userId, waNumber } = req.body;
    try {
        const existing = await db('WaAccount').where({ userId, waNumber }).first();
        if (!existing) {
            await db('WaAccount').insert({
                userId: parseInt(userId),
                waNumber,
                sessionName: `session_${waNumber}`,
                status: 'DISCONNECTED',
                createdAt: new Date()
            });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Database error" }); }
});

app.get('/api/user/my-accounts', async (req, res) => {
    const { userId } = req.query;
    try {
        const devices = await db('WaAccount').where({ userId });
        const updatedDevices = devices.map(dev => ({
            ...dev,
            status: activeSessions.has(`${userId}_session_${dev.waNumber}`) ? 'CONNECTED' : 'DISCONNECTED'
        }));
        res.json(updatedDevices);
    } catch (e) { res.status(500).json({ error: "Gagal ambil data" }); }
});

// --- STATS & WITHDRAW ---
app.get('/api/user/my-stats', async (req, res) => {
    const { userId } = req.query;
    try {
        const user = await db('User').where({ id: userId }).first() || { balance: 0 };
        const totalSent = await db('MessageLog').where({ userId }).count('id as total').first();
        const pendingWd = await db('Withdraw').where({ userId, status: 'PENDING' }).sum('amount as total').first();
        
        let connectedCount = 0;
        for (let clientId of activeSessions.keys()) {
            if (clientId.startsWith(`${userId}_`)) connectedCount++;
        }

        res.json({ 
            balance: user.balance,
            totalSent: parseInt(totalSent?.total) || 0,
            pendingWd: parseInt(pendingWd?.total) || 0,
            connectedCount: connectedCount
        });
    } catch (e) { res.status(500).json({ error: "Stats error" }); }
});

app.post('/api/user/withdraw', async (req, res) => {
    const { userId, amount, bankInfo } = req.body;
    try {
        const user = await db('User').where({ id: userId }).first();
        if (!user || user.balance < amount) return res.status(400).json({ error: "Saldo tipis!" });

        await db.transaction(async (trx) => {
            await trx('User').where({ id: userId }).decrement('balance', amount);
            await trx('Withdraw').insert({ userId, amount, bankInfo, status: 'PENDING', createdAt: new Date() });
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "WD error" }); }
});

// --- ADMIN API ---

app.get('/api/admin/users-full', async (req, res) => {
    try {
        const users = await db('User')
            .select('User.id', 'User.username', 'User.balance')
            .select(db.raw('(SELECT COUNT(*) FROM "MessageLog" WHERE "MessageLog"."userId" = "User"."id") as total_sent'));
        
        res.json(users.map(u => ({
            ...u,
            total_sent: parseInt(u.total_sent) || 0,
            balance: parseInt(u.balance) || 0
        })));
    } catch (e) { res.status(500).json({ error: "Admin API Error" }); }
});

app.get('/api/admin/withdraws', async (req, res) => {
    try {
        const withdraws = await db('Withdraw')
            .join('User', 'Withdraw.userId', 'User.id')
            .select('Withdraw.*', 'User.username')
            .orderBy('Withdraw.createdAt', 'desc');
        res.json(withdraws);
    } catch (e) { res.status(500).json({ error: "WD Admin Error" }); }
});

app.post('/api/admin/approve-wd/:id', async (req, res) => {
    try {
        await db('Withdraw').where({ id: req.params.id }).update({ status: 'SUCCESS' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Approve Error" }); }
});

app.get('/api/admin/online-sessions', async (req, res) => {
    try {
        let onlineList = [];
        for (let [clientId, client] of activeSessions.entries()) {
            const uId = clientId.split('_')[0];
            const user = await db('User').where({ id: uId }).first();
            onlineList.push({
                clientId,
                username: user ? user.username : 'Unknown',
                waNumber: client.info?.wid?.user || 'Connecting...'
            });
        }
        res.json(onlineList);
    } catch (e) { res.status(500).json({ error: "Session Admin Error" }); }
});

// BLAST ENGINE ADMIN DENGAN TARIF DINAMIS
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

        // Ambil tarif terbaru dari database
        const priceSetting = await db('Settings').where({ key: 'chat_price' }).first();
        const reward = priceSetting ? parseInt(priceSetting.value) : 500;

        await db.transaction(async (trx) => {
            await trx('User').where({ id: userId }).increment('balance', reward);
            await trx('MessageLog').insert({
                userId: userId, recipient: receiver, price: reward, status: 'SENT', createdAt: new Date()
            });
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[SERVER] On Port ${PORT}`));
