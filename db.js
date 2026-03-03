const knex = require('knex');

const db = knex({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  },
  pool: { 
    min: 2, 
    max: 10,
    acquireTimeoutMillis: 30000 // Beri waktu 30 detik untuk mencoba konek
  }
});

// ... sisa kode initDb kamu ...

// Fungsi untuk membuat tabel otomatis jika belum ada
async function initDb() {
    try {
        const hasUserTable = await db.schema.hasTable('User');
        if (!hasUserTable) {
            console.log("Mendeteksi database kosong, membuat tabel...");
            
            await db.schema.createTable('User', (table) => {
                table.increments('id').primary();
                table.string('username').unique();
                table.string('password');
                table.integer('balance').defaultTo(0);
            });

            await db.schema.createTable('WaAccount', (table) => {
                table.increments('id').primary();
                table.integer('userId');
                table.string('waNumber').unique();
                table.string('sessionName');
                table.string('status');
            });

            await db.schema.createTable('MessageLog', (table) => {
                table.increments('id').primary();
                table.integer('userId');
                table.string('recipient');
                table.integer('price');
                table.string('status');
                table.timestamp('createdAt').defaultTo(db.fn.now());
            });

            await db.schema.createTable('Withdraw', (table) => {
                table.increments('id').primary();
                table.integer('userId');
                table.integer('amount');
                table.string('bankInfo');
                table.string('status');
                table.timestamp('createdAt').defaultTo(db.fn.now());
            });
            console.log("✅ Semua tabel berhasil dibuat!");
        } else {
            console.log("✅ Database sudah siap.");
        }
    } catch (error) {
        console.error("❌ Gagal inisialisasi database:", error.message);
    }
}

initDb();

module.exports = db;
