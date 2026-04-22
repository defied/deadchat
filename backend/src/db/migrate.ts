import fs from 'fs';
import path from 'path';
import db from './connection';
import { hashPassword } from '../services/auth';

export function runMigrations(): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all()
      .map((row: any) => row.name)
  );

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`[migrate] Applying migration: ${file}`);

    db.exec(sql);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);

    console.log(`[migrate] Applied: ${file}`);
  }

  // Seed default admin user if no users exist
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    console.log('[migrate] Seeding default admin user...');
    const hash = hashPassword('admin123');
    db.prepare(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run('admin', 'admin@deadchat.local', hash, 'admin');
    console.log('[migrate] Default admin user created (username: admin, password: admin123)');
  }
}
