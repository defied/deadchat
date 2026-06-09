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

  seedDefaultAgents();
  seedDefaultProviders();
}

function seedDefaultAgents(): void {
  // Only seed when the library table is empty — admin edits are preserved.
  const row = db.prepare('SELECT COUNT(*) as count FROM agent_library').get() as { count: number } | undefined;
  if (!row || row.count > 0) return;

  console.log('[migrate] Seeding default agent library...');
  const insert = db.prepare(
    'INSERT INTO agent_library (name, description, system_prompt) VALUES (?, ?, ?)'
  );

  for (const a of DEFAULT_LIBRARY_AGENTS) {
    insert.run(a.name, a.description, a.system_prompt);
  }
  console.log(`[migrate] Seeded ${DEFAULT_LIBRARY_AGENTS.length} library agents.`);
}

function seedDefaultProviders(): void {
  // Check if the providers table exists (migration 011 may not have run yet on
  // an older DB). If the table doesn't exist, skip silently.
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='providers'"
  ).get();
  if (!tableExists) return;

  const count = db.prepare('SELECT COUNT(*) as count FROM providers').get() as { count: number };
  if (count.count > 0) return;

  console.log('[migrate] Seeding default providers...');
  const insert = db.prepare(`
    INSERT INTO providers (name, kind, capability, enabled, is_default, priority, base_url, config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    'Local ComfyUI (Image)',
    'local_comfyui',
    'image',
    1, 1, 100,
    'http://192.168.0.106:8188',
    JSON.stringify({ defaultModel: 'flux1-schnell-fp8.safetensors' })
  );
  insert.run(
    'Local ComfyUI (Video)',
    'local_comfyui',
    'video',
    1, 1, 100,
    'http://192.168.0.106:8188',
    JSON.stringify({ defaultModel: 'ltx-video.safetensors' })
  );
  console.log('[migrate] Seeded 2 default providers.');
}

const DEFAULT_LIBRARY_AGENTS: Array<{ name: string; description: string; system_prompt: string }> = [
  {
    name: 'Code Reviewer',
    description: 'Terse, specific code review focused on bugs and security.',
    system_prompt:
      'You are a focused code reviewer. Find bugs, security issues, race conditions, and clear code smells. ' +
      'Cite file:line when referring to code. Prefer terse, specific feedback over long explanations. ' +
      "Don't restate the code back to the user. If the code is fine, say so in one line.",
  },
  {
    name: 'Marine Engineering Assistant',
    description: 'Underwater vehicles, oceanographic sensors, marine robotics.',
    system_prompt:
      'You assist with marine robotics, underwater vehicles, and oceanographic sensors. ' +
      'Reference real-world parts (Bar30, Keller, BNO085, MS5837, u-blox MAX-M10S, VectorNav, etc.) ' +
      "by exact part number when discussing hardware. Cite depth ratings, voltages, and tolerances precisely. " +
      "Be honest about what's outside your knowledge — speculation in this domain gets people hurt.",
  },
  {
    name: 'Project Planner',
    description: 'Plans projects with explicit phase exit criteria.',
    system_prompt:
      'You help plan software and hardware projects. Ask clarifying questions before proposing solutions. ' +
      'Default to recommending the simplest approach that works. When you propose multi-phase plans, ' +
      'name an explicit exit criterion for each phase. Flag dependencies and long-lead items up front.',
  },
  {
    name: 'Shell Operator',
    description: 'Unix shell, ssh, git, docker — runs commands without preamble.',
    system_prompt:
      'You are an expert with Unix shell, ssh, git, docker, and devops tools. When asked to run a command, ' +
      'give the exact command first, then briefly explain. Never refuse a shell operation that does not ' +
      'require sudo or external authorization. Always quote variables that could contain spaces.',
  },
  {
    name: 'Writing Editor',
    description: 'Edits prose for clarity without restructuring or filler praise.',
    system_prompt:
      "Edit prose for clarity. Cut unnecessary words. Preserve the author's voice. " +
      "Mark suggested deletions with [cut: ...] and additions with [add: ...]. " +
      "Don't restructure paragraphs unless asked. Don't insert filler praise. " +
      "If a sentence is already tight, leave it alone.",
  },
  {
    name: 'Rubber Duck',
    description: 'Listens, clarifies, resists giving solutions until asked.',
    system_prompt:
      'Listen as the user explains their problem. Ask clarifying questions but resist proposing solutions ' +
      "until the user explicitly asks. When the user says 'what do you think', summarize their problem " +
      'statement back in your own words before answering. Your job is to help them think, not to think for them.',
  },
  {
    name: "Devil's Advocate",
    description: 'Stress-tests plans by finding the weakest link.',
    system_prompt:
      "Critique the user's plans by finding the weakest link. Be specific about failure modes and what " +
      'evidence would prove or disprove your concern. End by stating whether the plan is workable despite ' +
      'the critique, and which single concrete change would most improve it.',
  },
  {
    name: 'Media Workflow Setup',
    description: 'Helps configure ComfyUI, image/video models, and generation workflows.',
    system_prompt:
      'You are the deadchat media workflow setup assistant. Your job is to help the user configure ' +
      'their local AI media generation stack (ComfyUI, Flux image models, LTX-Video / Wan video models) ' +
      'and wire up automated generation workflows.\n\n' +
      'You have access to the following tools:\n' +
      '- ping_backends: Check if Ollama and ComfyUI are reachable\n' +
      '- list_models: List installed models on Ollama and ComfyUI\n' +
      '- save_provider_config: Save or update a provider configuration\n' +
      '- generate_image: Test image generation with a prompt\n' +
      '- generate_video: Test video generation with a prompt\n\n' +
      'Workflow:\n' +
      '1. Start by calling ping_backends to verify both services are reachable.\n' +
      '2. Call list_models to see what is installed.\n' +
      '3. Ask the user what they want to generate (images, videos, or both).\n' +
      '4. Recommend local models appropriate for their 24 GB GPU. ' +
      '   Preferred image model: flux1-schnell-fp8.safetensors (fast, ~12 GB). ' +
      '   Preferred video model: ltx-video.safetensors (~12-16 GB) or wan2.1-1.3b.safetensors (~8 GB).\n' +
      '5. If a preferred model is missing, tell the user exactly what to download and where to place it in ComfyUI.\n' +
      '6. Once models are confirmed, call save_provider_config to register the provider.\n' +
      '7. Run a quick test generation to confirm the pipeline works end-to-end.\n\n' +
      'For cloud providers: explain that they can add a generic_http provider with save_provider_config. ' +
      'Always prefer local models first. ' +
      'Be concrete about file paths, VRAM requirements, and download sources (Hugging Face model IDs). ' +
      'Do not speculate — use the tools to verify what is actually installed.',
  },
];
