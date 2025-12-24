import { NextRequest, NextResponse } from 'next/server';

// POST - Receive transcript via webhook
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transcript, title, language, metadata } = body;

    if (!transcript) {
      return NextResponse.json(
        { error: 'Transcript is required' },
        { status: 400 }
      );
    }

    // Validate language (default to 'en' if not provided)
    const validLanguages = ['en', 'pl', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'];
    const selectedLanguage = language && validLanguages.includes(language) ? language : 'en';

    // Generate a unique job ID for tracking
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Store the transcript temporarily (in production, use a database)
    // For now, we'll return it immediately for processing
    const response = {
      success: true,
      jobId,
      message: 'Transcript received successfully',
      language: selectedLanguage,
      nextStep: {
        url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/webhook/process`,
        method: 'POST',
        body: {
          jobId,
          transcript,
          title: title || 'Untitled Podcast',
          language: selectedLanguage,
          metadata: metadata || {},
        },
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error receiving transcript webhook:', error);
    return NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500 }
    );
  }
}

