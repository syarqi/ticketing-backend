import bcrypt from 'bcryptjs';
import { pool } from './pool';
import { env } from '../config/env';

/**
 * Idempotent seed script: safe to run multiple times.
 * Seeds master data (locations, priorities, update types) and one
 * initial admin user, only when they don't already exist.
 */
async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- Locations ---
    const locations = ['Server A', 'Server B', 'Server C', 'Server D', 'Server E', 'Server F', 'Server G'];
    for (const name of locations) {
      await client.query(
        `INSERT INTO locations (name) VALUES ($1)
         ON CONFLICT (name) DO NOTHING`,
        [name]
      );
    }

    // --- Priorities (fixed levels so sort order is deterministic) ---
    const priorities: Array<{ name: string; color: string; level: number }> = [
      { name: 'Critical', color: 'red', level: 1 },
      { name: 'High', color: 'yellow', level: 2 },
      { name: 'Normal', color: 'green', level: 3 },
      { name: 'Low', color: 'blue', level: 4 },
    ];
    for (const p of priorities) {
      await client.query(
        `INSERT INTO priorities (name, color, level) VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET color = EXCLUDED.color, level = EXCLUDED.level`,
        [p.name, p.color, p.level]
      );
    }

    // --- Update types ---
    const updateTypes = [
      'Sedang pengecekan',
      'Sedang perbaikan',
      'Cek perangkat',
      'Menunggu perangkat',
      'Ada kendala',
      'Menunggu pihak lain',
      'Perbaikan selesai',
    ];
    for (const name of updateTypes) {
      await client.query(
        `INSERT INTO update_types (name) VALUES ($1)
         ON CONFLICT (name) DO NOTHING`,
        [name]
      );
    }

    // --- Initial admin user ---
    const { rows: existingAdmins } = await client.query(
      'SELECT id FROM users WHERE username = $1',
      [env.seedAdminUsername]
    );

    if (existingAdmins.length === 0) {
      if (!env.seedAdminPassword) {
        console.warn(
          'SEED_ADMIN_PASSWORD is not set in .env — skipping admin user creation. ' +
            'Set it and re-run `npm run seed` to create the initial admin.'
        );
      } else {
        const passwordHash = await bcrypt.hash(env.seedAdminPassword, 12);
        await client.query(
          `INSERT INTO users (username, password_hash, full_name, role, is_active)
           VALUES ($1, $2, $3, 'ADMIN', TRUE)`,
          [env.seedAdminUsername, passwordHash, env.seedAdminFullname]
        );
        console.log(`Created initial admin user "${env.seedAdminUsername}".`);
      }
    } else {
      console.log(`Admin user "${env.seedAdminUsername}" already exists — skipping.`);
    }

    await client.query('COMMIT');
    console.log('Seed complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
