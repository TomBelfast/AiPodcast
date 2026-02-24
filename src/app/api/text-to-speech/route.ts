import { NextRequest, NextResponse } from "next/server";
import { createDialogue } from "@/actions/dialogue";
import { CreateDialogueRequest } from "@/types";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const body: CreateDialogueRequest = await request.json();

    // Verify user identity
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.split(' ')[1];

    let userEmail = '';

    if (token) {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user?.email) {
        userEmail = user.email;
      }
    }

    const isAdmin = userEmail === 'tomaszpasiekauk@gmail.com';

    // 3. Get Admin Fallback Settings
    const { getEffectiveAdminSettings } = await import("@/lib/admin-settings");
    const adminSettings = getEffectiveAdminSettings();

    // Access Control Logic
    if (!body.apiKey) {
      if (isAdmin || !authHeader) {
        body.apiKey = adminSettings.elevenlabs_api_key;
      }
    }

    if (!body.apiKey) {
      return NextResponse.json(
        {
          error: "Please complete your ElevenLabs API Key in Settings",
          code: "MISSING_ELEVENLABS_KEY"
        },
        { status: 403 }
      );
    }

    if (!body.inputs || body.inputs.length === 0) {
      return NextResponse.json(
        { error: "Dialogue inputs are required" },
        { status: 400 }
      );
    }

    console.log("body", body.inputs);

    // Validate each dialogue input
    for (const input of body.inputs) {
      if (!input.text || !input.voiceId) {
        return NextResponse.json(
          { error: "Each dialogue input must have text and voiceId" },
          { status: 400 }
        );
      }
    }

    const result = await createDialogue(body);

    if (!result.ok) {
      console.error("Error generating dialogue:", result.error);
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      audioBase64: result.value.audioBase64,
      voiceSegments: result.value.voiceSegments,
      alignment: result.value.alignment,
      normalizedAlignment: result.value.normalizedAlignment,
      processingTimeMs: result.value.processingTimeMs,
    });
  } catch (error) {
    console.error("Error processing dialogue request:", error);
    return NextResponse.json(
      { error: "Failed to process dialogue request" },
      { status: 500 }
    );
  }
}
