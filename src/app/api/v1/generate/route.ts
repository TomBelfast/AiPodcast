import { NextRequest, NextResponse } from 'next/server';
import { createDialogue } from '@/actions/dialogue';
import { CreateDialogueRequest } from '@/types';
import { promises as fs } from 'fs';
import path from 'path';

const ARCHIVE_DIR = path.join(process.cwd(), 'archive');

// Ensure archive directory exists
async function ensureArchiveDir() {
    try {
        await fs.access(ARCHIVE_DIR);
    } catch {
        await fs.mkdir(ARCHIVE_DIR, { recursive: true });
    }
}

export async function POST(req: NextRequest) {
    try {
        // 1. Authenticate
        const apiKey = req.headers.get('x-api-key');
        const validApiKey = process.env.APP_API_KEY || '1824d3c217681b1dabf6e9764c277781';

        if (apiKey !== validApiKey) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 2. Parse Request
        const body = await req.json();
        const { transcript, title, language = 'pl', voice1, voice2 } = body;

        if (!transcript) {
            return NextResponse.json({ error: 'Transcript is required' }, { status: 400 });
        }

        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // 3. Generate Conversation (Calling the internal logic via fetch to its own API)
        // We use the internal URL. APP_URL fallback to localhost:3300
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3300';

        const generateRes = await fetch(`${appUrl}/api/generate-podcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: transcript,
                title: title || 'Podcast',
                language,
            }),
        });

        if (!generateRes.ok) {
            const errorText = await generateRes.text();
            throw new Error(`Failed to generate conversation: ${errorText}`);
        }

        // The generate-podcast returns a stream of partial/complete objects
        // We need to parse the complete one
        const reader = generateRes.body?.getReader();
        if (!reader) throw new Error('Failed to read generation stream');

        let conversation = null;
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(l => l.trim());

            for (const line of lines) {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.type === 'complete') {
                        conversation = parsed.data.conversation;
                    }
                } catch (e) {
                    console.warn('Failed to parse stream chunk', e);
                }
            }
        }

        if (!conversation) {
            throw new Error('Could not extract conversation from generation');
        }

        // 4. Generate Audio
        const voice1Id = voice1 || 'FF7KdobWPaiR0vkcALHF';
        const voice2Id = voice2 || 'BpjGufoPiobT79j2vtj4';

        const dialogueInputs = conversation.map((item: { speaker: string; text: string }) => ({
            text: item.text,
            voiceId: item.speaker === 'Speaker1' ? voice1Id : voice2Id,
        }));

        const result = await createDialogue({ inputs: dialogueInputs });

        if (!result.ok) {
            throw new Error(`Audio generation failed: ${result.error}`);
        }

        const audioBase64 = result.value.audioBase64;

        // 5. Save Locally
        await ensureArchiveDir();
        const base64Data = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
        const audioBuffer = Buffer.from(base64Data, 'base64');
        const safeTitle = (title || 'podcast').replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        const filename = `${safeTitle}_${jobId}.mp3`;
        const filePath = path.join(ARCHIVE_DIR, filename);
        await fs.writeFile(filePath, audioBuffer);

        // 6. Return response
        const downloadUrl = `${appUrl}/api/webhook/download/${jobId}`;

        return NextResponse.json({
            success: true,
            jobId,
            downloadUrl,
            filename,
            message: 'Podcast generated successfully',
        });

    } catch (error: any) {
        console.error('API v1 Error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
