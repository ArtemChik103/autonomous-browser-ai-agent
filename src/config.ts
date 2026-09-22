import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const rawKeys = process.env.GEMINI_API_KEYS
  ? process.env.GEMINI_API_KEYS.split(',').map((k) => k.trim()).filter(Boolean)
  : (process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY.trim()] : []);

export const config = {
  geminiApiKey: rawKeys[0] || process.env.GEMINI_API_KEY || '',
  geminiApiKeys: rawKeys.length > 0 ? rawKeys : (process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY] : []),
  orchestratorModel: process.env.ORCHESTRATOR_MODEL || 'gemini-3.5-flash-lite',
  domSubagentModel: process.env.DOM_SUBAGENT_MODEL || 'gemini-3.5-flash-lite',
  headless: process.env.HEADLESS === 'true',
  userDataDir: path.resolve(process.env.USER_DATA_DIR || './.browser_profile'),
  viewport: {
    width: parseInt(process.env.VIEWPORT_WIDTH || '1280', 10),
    height: parseInt(process.env.VIEWPORT_HEIGHT || '800', 10),
  },
  stepCooldownMs: parseInt(process.env.STEP_COOLDOWN_MS || '1000', 10),
  port: parseInt(process.env.PORT || '3000', 10),
};
