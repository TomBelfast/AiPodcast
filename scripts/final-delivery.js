const fs = require('fs');
const path = require('path');

// Load .env.local
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

async function runTest() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        console.error('❌ Error: ELEVENLABS_API_KEY not found');
        return;
    }

    const jobId = `final_${Date.now()}`;
    const archiveDir = path.join(process.cwd(), 'archive');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);

    const conversation = [
        { speaker: 'Antoni', text: 'To jest ostatni test przed oddaniem projektu.' },
        { speaker: 'Zofia', text: 'Wszystko działa idealnie, od plików MP3 po znormalizowane JSONy.' }
    ];

    const voice1Id = 'FF7KdobWPaiR0vkcALHF';
    const voice2Id = 'BpjGufoPiobT79j2vtj4';

    const payload = {
        modelId: 'eleven_v3',
        inputs: conversation.map(item => ({
            text: item.text,
            voiceId: (item.speaker === 'Antoni') ? voice1Id : voice2Id
        })),
        includeTimestamps: true
    };

    try {
        const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
        const client = new ElevenLabsClient({ apiKey });

        const response = await client.textToDialogue.convertWithTimestamps(payload);

        // Mimic API logic
        const audioFilename = `podcast_${jobId}.mp3`;
        const jsonFilename = `podcast_${jobId}.json`;

        fs.writeFileSync(path.join(archiveDir, audioFilename), Buffer.from(response.audioBase64, 'base64'));
        
        // Use the raw metadata structure we defined
        const rawMetadata = {
            jobId,
            title: 'Ostateczna Weryfikacja',
            speakers: {
                Antoni: { name: 'Antoni', voiceId: voice1Id, gender: 'male', personality: 'Silesian/Energetic' },
                Zofia: { name: 'Zofia', voiceId: voice2Id, gender: 'female', personality: 'Goral/Pessimistic' }
            },
            conversation,
            voiceSegments: response.voiceSegments,
            alignment: response.alignment,
            normalizedAlignment: response.normalizedAlignment,
            audioFilename,
            timestamp: new Date().toISOString()
        };

        // PARSE
        const { parseElevenLabsTranscript } = require('./parser-shim-v2');
        const metadata = parseElevenLabsTranscript(rawMetadata);
        fs.writeFileSync(path.join(archiveDir, jsonFilename), JSON.stringify(metadata, null, 2));

        console.log(`Job ID: ${jobId}`);
        console.log(`MP3: archive/${audioFilename}`);
        console.log(`JSON: archive/${jsonFilename}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

function parseElevenLabsTranscript(input) {
    const formatTime = s => { let d=new Date(0); d.setMilliseconds(s*1000); return d.toISOString().substr(11,8)+','+Math.floor(s*1000%1000).toString().padStart(3,'0'); };
    const segments = input.voiceSegments.map((vs, i) => ({
        id: i, speaker: vs.voiceId === 'FF7KdobWPaiR0vkcALHF' ? 'Antoni' : 'Zofia',
        start_time: vs.startTimeSeconds, end_time: vs.endTimeSeconds,
        text: input.conversation[vs.dialogueInputIndex].text
    }));
    const alignment = input.normalizedAlignment || input.alignment;
    const words = [];
    const punctuation = '.,!?;:()[]{}"„”\'«»';
    input.voiceSegments.forEach((vs, segIdx) => {
        const chars = alignment.characters.slice(vs.characterStartIndex, vs.characterEndIndex);
        const starts = alignment.characterStartTimesSeconds.slice(vs.characterStartIndex, vs.characterEndIndex);
        const ends = alignment.characterEndTimesSeconds.slice(vs.characterStartIndex, vs.characterEndIndex);
        let buf = [], bS = [], bE = [];
        const proc = () => {
            let s=0, e=buf.length-1;
            while(s<buf.length && punctuation.includes(buf[s])) s++;
            while(e>=s && punctuation.includes(buf[e])) e--;
            if(s<=e) words.push({ id: words.length, segment_id: segIdx, speaker: vs.voiceId==='FF7KdobWPaiR0vkcALHF'?'Antoni':'Zofia', text: buf.slice(s,e+1).join(''), start_time: bS[s], end_time: bE[e] });
            buf=[]; bS=[]; bE=[];
        };
        for(let i=0; i<chars.length; i++) {
            if(/\s/.test(chars[i])) { if(buf.length) proc(); }
            else { buf.push(chars[i]); bS.push(starts[i]); bE.push(ends[i]); }
        }
        if(buf.length) proc();
    });
    return { job_id: input.jobId, title: input.title, duration_seconds: segments[segments.length-1].end_time, full_text: segments.map(s=>s.text).join(' '), segments, words, srt: segments.map((s,i)=>`${i+1}\n00:00:00,000 --> 00:00:00,000\n${s.speaker}: ${s.text}\n`).join('\n') };
}

fs.writeFileSync('scripts/parser-shim-v2.js', `module.exports = { parseElevenLabsTranscript: ${parseElevenLabsTranscript.toString()} };`);

runTest();
