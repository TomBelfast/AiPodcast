const fs = require('fs');
const path = require('path');

// Minimal manual .env.local parser
function loadEnv() {
    try {
        const envPath = path.resolve(__dirname, '../.env.local');
        const envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split('\n');
        for (const line of lines) {
            if (line.includes('=') && !line.startsWith('#')) {
                const [key, ...valueParts] = line.split('=');
                const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
                process.env[key.trim()] = value;
            }
        }
    } catch (err) {
        console.error('Warning: Could not load .env.local', err.message);
    }
}

loadEnv();

async function testAndDownload() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        console.error('❌ Error: ELEVENLABS_API_KEY not found in .env.local');
        return;
    }

    console.log('--- ElevenLabs Sync Test Tool ---');

    // You can customize this payload
    const payload = {
        modelId: 'eleven_v3',
        inputs: [
            { text: 'Pierwsza osoba mówi o technologii.', voiceId: 'FF7KdobWPaiR0vkcALHF' },
            { text: 'Druga osoba odpowiada o wizji przyszłości.', voiceId: 'BpjGufoPiobT79j2vtj4' }
        ],
        includeTimestamps: true
    };

    try {
        // We call the internal action logic directly for the test
        // In a real app, you'd use the API URL if calling from outside
        const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
        const client = new ElevenLabsClient({ apiKey });

        console.log('Sending request to ElevenLabs...');
        const response = await client.textToDialogue.convertWithTimestamps(payload);

        // 1. Save MP3
        const audioBuffer = Buffer.from(response.audioBase64, 'base64');
        fs.writeFileSync('test-output.mp3', audioBuffer);
        console.log('✅ Audio saved to: test-output.mp3');

        // 2. Save Timestamps
        const metadata = {
            voiceSegments: response.voiceSegments,
            alignment: response.alignment,
            normalizedAlignment: response.normalizedAlignment
        };
        fs.writeFileSync('test-timestamps.json', JSON.stringify(metadata, null, 2));
        console.log('✅ Timestamps saved to: test-timestamps.json');

        console.log('\nSummary:');
        console.log(`- Audio size: ${(audioBuffer.length / 1024).toFixed(2)} KB`);
        console.log(`- Segments: ${response.voiceSegments.length}`);
        console.log(`- Total characters: ${response.alignment.characters.length}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testAndDownload();
