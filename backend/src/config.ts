import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  jwtSecret: process.env.JWT_SECRET || 'deadchat-secret-change-me',
  jwtExpiry: '15m',
  refreshExpiry: '7d',
  ollamaUrl: process.env.OLLAMA_URL || 'http://192.168.0.106:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen3.8:27b',
  // Context window for web-chat requests when an admin hasn't set num_ctx for
  // the model. Ollama otherwise loads the model's full window (262k for
  // qwen3.8), which spills most of a 27B model to CPU on a 24 GB GPU
  // (~5 tok/s vs ~150 tok/s fully on GPU at 32k). 0 = let Ollama decide.
  chatNumCtx: parseInt(process.env.CHAT_NUM_CTX || '32768'),
  dbPath: process.env.DB_PATH || './data/deadchat.db',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'),
  // Media generation
  comfyuiUrl: process.env.COMFYUI_URL || 'http://192.168.0.106:8188',
  ttsUrl: process.env.TTS_URL || 'http://192.168.0.106:8020',
  mediaDir: process.env.MEDIA_DIR || './data/media',
  secretsKey: process.env.SECRETS_KEY || '',
  runWorker: process.env.RUN_WORKER !== 'false',
};
