import fs from 'fs';
import path from 'path';

async function testCurrentEnv() {
    console.log("Checking current configuration...");
    
    // Read .env.local manually to see what's in it
    const envPath = path.join(process.cwd(), '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const apiKeyMatch = envContent.match(/ELEVENLABS_API_KEY=(.*)/);
    
    if (!apiKeyMatch) {
        console.error("❌ ELEVENLABS_API_KEY NOT FOUND in .env.local!");
        process.exit(1);
    }
    
    const currentKey = apiKeyMatch[1].trim();
    console.log("✅ Key found in .env.local:", currentKey.substring(0, 5) + "...");
    
    try {
        console.log("Sending verification request to ElevenLabs...");
        const response = await fetch("https://api.elevenlabs.io/v1/user", {
            headers: { "xi-api-key": currentKey }
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log("✅ API Connection: OK");
            console.log("Plan:", data.subscription.tier);
            console.log("Characters:", `${data.subscription.character_count}/${data.subscription.character_limit}`);
            console.log("SUCCESS: Everything is configured and working properly.");
        } else {
            const error = await response.json();
            console.error("❌ API Connection: FAILED");
            console.error("Error:", JSON.stringify(error, null, 2));
            process.exit(1);
        }
    } catch (e) {
        console.error("❌ Network Error:", e.message);
        process.exit(1);
    }
}

testCurrentEnv();
