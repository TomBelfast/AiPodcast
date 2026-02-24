import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), '.admin_settings.json');

export interface AdminSettings {
    openai_api_key?: string;
    elevenlabs_api_key?: string;
    main_prompt?: string;
    polish_ending_prompt?: string;
    host_prompt_polish?: string;
    host_prompt_other?: string;
    updated_at?: string;
}

/**
 * Saves admin settings to a local JSON file.
 * This file acts as a cache/fallback for session-less processes like webhooks.
 */
export function saveAdminSettingsLocal(settings: AdminSettings) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(settings, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error("Failed to save local admin settings:", error);
        return false;
    }
}

/**
 * Loads admin settings from the local JSON file.
 */
export function loadAdminSettingsLocal(): AdminSettings | null {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error("Failed to load local admin settings:", error);
    }
    return null;
}

/**
 * Get effective settings, falling back to environment variables.
 */
export function getEffectiveAdminSettings(): AdminSettings {
    const local = loadAdminSettingsLocal() || {};

    return {
        openai_api_key: local.openai_api_key || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY,
        elevenlabs_api_key: local.elevenlabs_api_key || process.env.ELEVENLABS_API_KEY,
        main_prompt: local.main_prompt,
        polish_ending_prompt: local.polish_ending_prompt,
        host_prompt_polish: local.host_prompt_polish,
        host_prompt_other: local.host_prompt_other,
        updated_at: local.updated_at
    };
}
