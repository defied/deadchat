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
  patchAgentFlags();
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

function patchAgentFlags(): void {
  // Ensure the agentic column exists (migration 014) before patching.
  const cols = db.prepare('PRAGMA table_info(agent_library)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'agentic')) return;

  db.prepare(
    "UPDATE agent_library SET agentic = 1 WHERE name = 'Media Workflow Setup' AND agentic = 0"
  ).run();
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
    JSON.stringify({ defaultModel: 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors' })
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
      'IMPORTANT: After every tool call, output a Mermaid architecture diagram showing the current ' +
      'state of the stack. Use flowchart LR layout. Mark reachable services green (style fill:#22c55e20,' +
      'stroke:#22c55e), unreachable red (fill:#ef444420,stroke:#ef4444), and missing models amber ' +
      '(fill:#f59e0b20,stroke:#f59e0b). Example:\n\n' +
      '```mermaid\n' +
      'flowchart LR\n' +
      '  U([User]) --> DC[Deadchat]\n' +
      '  DC --> OL["Ollama\\n192.168.0.106:11434"]\n' +
      '  DC --> CF["ComfyUI\\n192.168.0.106:8188"]\n' +
      '  OL --> M1["gemma4 ✓"]\n' +
      '  CF --> IMG["flux1-schnell\\n(missing)"]\n' +
      '  style OL fill:#22c55e20,stroke:#22c55e\n' +
      '  style CF fill:#22c55e20,stroke:#22c55e\n' +
      '  style IMG fill:#f59e0b20,stroke:#f59e0b\n' +
      '```\n\n' +
      'Workflow:\n' +
      '1. Start by calling ping_backends to verify both services are reachable.\n' +
      '2. Call list_models to see what is installed.\n' +
      '3. Output the Mermaid diagram reflecting current state.\n' +
      '4. Ask the user what they want to generate (images, videos, or both).\n' +
      '5. Recommend local models for a 24 GB GPU:\n' +
      '   - Image: flux1-schnell-fp8.safetensors (fast, ~12 GB VRAM)\n' +
      '   - Video: ltxv-2b-0.9.8-distilled-fp8.safetensors (~4 GB fp8) from Lightricks/LTX-Video\n' +
      '6. If a model is missing, give exact download instructions (Hugging Face model ID, target path).\n' +
      '7. Call save_provider_config to register confirmed providers.\n' +
      '8. Run a test generation (generate_image or generate_video) to confirm end-to-end.\n' +
      '9. Output a final updated diagram showing the fully configured stack.\n\n' +
      'Cloud providers: save_provider_config supports generic_http kind — explain this option if asked. ' +
      'Always prefer local models. Be concrete: file paths, VRAM numbers, HuggingFace IDs. ' +
      'Never speculate — use tools to verify what is actually installed.',
  },
];
