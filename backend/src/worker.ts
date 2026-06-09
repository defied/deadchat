// Standalone worker entrypoint for k8s deployments where the API and worker
// run as separate Deployment replicas (set RUN_WORKER=false on the API pods).
// Always runs exactly one replica — the job queue's BEGIN IMMEDIATE guard
// enforces single-GPU serialization across restarts.

import './config'; // ensures dotenv is loaded
import { runMigrations } from './db/migrate';
import { startWorker } from './services/worker';
import { startScheduler } from './services/scheduler';

console.log('[worker-entrypoint] Running migrations...');
runMigrations();
console.log('[worker-entrypoint] Starting worker + scheduler...');
startWorker();
startScheduler();
