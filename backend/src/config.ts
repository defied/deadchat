import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  jwtSecret: process.env.JWT_SECRET || 'deadchat-secret-change-me',
  jwtExpiry: '15m',
  refreshExpiry: '7d',
  ollamaUrl: process.env.OLLAMA_URL || 'http://192.168.0.106:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'gemma4',
  dbPath: process.env.DB_PATH || './data/deadchat.db',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'),
};
