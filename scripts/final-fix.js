const fs = require('fs');
const path = require('path');

function formatSrtTime(seconds) {
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const ss = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mm = totalMinutes % 60;
  const hh = Math.floor(totalMinutes / 60);
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

function parseElevenLabsTranscript(input) {
  const segments = input.voiceSegments.map((vs, i) => ({
    id: i, speaker: vs.voiceId === 'FF7KdobWPaiR0vkcALHF' ? 'Antoni' : 'Zofia',
    voice_id: vs.voiceId, dialogue_input_index: vs.dialogueInputIndex,
    start_time: Math.round(vs.startTimeSeconds * 1000) / 1000,
    end_time: Math.round(vs.endTimeSeconds * 1000) / 1000,
    text: input.conversation[vs.dialogueInputIndex].text.trim()
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
      if(s<=e) words.push({ id: words.length, segment_id: segIdx, speaker: vs.voiceId==='FF7KdobWPaiR0vkcALHF'?'Antoni':'Zofia', voice_id: vs.voiceId, text: buf.slice(s,e+1).join(''), start_time: Math.round(bS[s]*1000)/1000, end_time: Math.round(bE[e]*1000)/1000 });
      buf=[]; bS=[]; bE=[];
    };
    for(let i=0; i<chars.length; i++) {
        if(/\s/.test(chars[i])) { if(buf.length) proc(); }
        else { buf.push(chars[i]); bS.push(starts[i]); bE.push(ends[i]); }
    }
    if(buf.length) proc();
  });
  return { source: "elevenlabs", version: 1, job_id: input.jobId, title: input.title, audio_filename: input.audioFilename, timestamp: input.timestamp, duration_seconds: Math.round(segments[segments.length-1].end_time * 1000) / 1000, full_text: segments.map(s=>s.text).join(' '), speakers: Object.entries(input.speakers).map(([id, d]) => ({ id, name: d.name, voice_id: d.voiceId, gender: d.gender, personality: d.personality })), segments, words, srt: segments.map((s,i)=>`${i+1}\n${formatSrtTime(s.start_time)} --> ${formatSrtTime(s.end_time)}\n${s.speaker}: ${s.text}\n`).join('\n'), warnings: [] };
}

async function start() {
    const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => { if (line.includes('=') && !line.startsWith('#')) { const [k, ...v] = line.split('='); acc[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, ''); } return acc; }, {});
    const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
    const client = new ElevenLabsClient({ apiKey: env.ELEVENLABS_API_KEY });
    const conversation = [{ speaker: 'Antoni', text: 'To jest ostatni test przed oddaniem projektu.' }, { speaker: 'Zofia', text: 'Wszystko działa idealnie, od plików MP3 po znormalizowane JSONy.' }];
    const res = await client.textToDialogue.convertWithTimestamps({ modelId: 'eleven_v3', includeTimestamps: true, inputs: conversation.map(i => ({ text: i.text, voiceId: i.speaker === 'Antoni' ? 'FF7KdobWPaiR0vkcALHF' : 'BpjGufoPiobT79j2vtj4' })) });
    const jobId = 'final_fix_' + Date.now();
    const raw = { jobId, title: 'Podcast Finalny Fix', speakers: { Antoni: { name: 'Antoni', voiceId: 'FF7KdobWPaiR0vkcALHF', gender: 'male', personality: 'Silesian/Energetic' }, Zofia: { name: 'Zofia', voiceId: 'BpjGufoPiobT79j2vtj4', gender: 'female', personality: 'Goral/Pessimistic' } }, conversation, voiceSegments: res.voiceSegments, alignment: res.alignment, normalizedAlignment: res.normalizedAlignment, audioFilename: `podcast_${jobId}.mp3`, timestamp: new Date().toISOString() };
    const result = parseElevenLabsTranscript(raw);
    if (!fs.existsSync('archive')) fs.mkdirSync('archive');
    fs.writeFileSync(`archive/podcast_${jobId}.mp3`, Buffer.from(res.audioBase64, 'base64'));
    fs.writeFileSync(`archive/podcast_${jobId}.json`, JSON.stringify(result, null, 2));
    console.log(`Job: ${jobId}`);
}
start();
