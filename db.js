const knex = require('knex');

const db = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL, // Ambil dari .env kamu
  pool: { min: 2, max: 10 }
});

module.exports = db;