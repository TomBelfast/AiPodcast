const { getEffectiveAdminSettings } = require('./dist/lib/admin-settings'); // Assuming it's compiled or we use ts-node
// Actually, easier to just run a node script that mocks the paths.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(process.cwd(), '.admin_settings.json');

function loadAdminSettingsLocal() {
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

const settings = loadAdminSettingsLocal();
console.log("Loaded Settings:", settings);
if (settings && settings.openai_api_key && settings.elevenlabs_api_key) {
    console.log("SUCCESS: Keys are present in local settings.");
} else {
    console.log("FAILURE: Keys missing or file not found.");
}
