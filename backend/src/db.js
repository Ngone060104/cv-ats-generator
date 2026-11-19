'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 10,
  connectionTimeoutMillis: 5000, // échoue vite si PostgreSQL ne répond pas
  idleTimeoutMillis: 30000,
  statement_timeout: 20000 // aucune requête SQL ne peut bloquer le serveur plus de 20 s
});

// Sans ce gestionnaire, une connexion inactive qui tombe ferait planter tout le serveur.
pool.on('error', (err) => {
  console.error('[pg] Erreur sur une connexion inactive :', err.message);
});

/** Exécute fn(client) dans une transaction (COMMIT si OK, ROLLBACK sinon). */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
