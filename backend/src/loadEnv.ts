import { config as loadEnv } from 'dotenv';

// Must run before any module reads process.env (e.g. llm/clients.ts).
loadEnv();
