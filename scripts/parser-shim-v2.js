module.exports = { parseElevenLabsTranscript: function parseElevenLabsTranscript(input) {
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
} };