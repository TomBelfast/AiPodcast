import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
    try {
        // 1. Verify user identity
        const authHeader = req.headers.get('Authorization');
        const token = authHeader?.split(' ')[1];

        if (!token) {
            return NextResponse.json({ error: "Missing authorization" }, { status: 401 });
        }

        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 2. ONLY ALLOW tomaszpasiekauk@gmail.com
        if (user.email !== 'tomaszpasiekauk@gmail.com') {
            return NextResponse.json({ error: "Forbidden: Admin access color only." }, { status: 403 });
        }

        // 3. Read keys from environment
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const elevenlabsApiKey = process.env.ELEVENLABS_API_KEY;
        const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

        if (!openaiApiKey && !elevenlabsApiKey && !geminiApiKey) {
            return NextResponse.json({ error: "No system keys found in environment" }, { status: 404 });
        }

        // 4. Fetch full current settings from Supabase
        const { data: currentSettings } = await supabase
            .from('user_settings')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();

        const settingsToSave = {
            ...(currentSettings || {}),
            user_id: user.id,
            openai_api_key: openaiApiKey,
            elevenlabs_api_key: elevenlabsApiKey,
            gemini_api_key: geminiApiKey,
            updated_at: new Date().toISOString(),
        };

        // 5. Upsert into database
        const { error: dbError } = await supabase
            .from('user_settings')
            .upsert(settingsToSave, { onConflict: 'user_id' });

        if (dbError) {
            console.error("Database error during sync:", dbError);
            return NextResponse.json({ error: "Failed to sync keys to database" }, { status: 500 });
        }

        // 6. Save locally for webhook fallback
        const { saveAdminSettingsLocal } = await import("@/lib/admin-settings");
        saveAdminSettingsLocal(settingsToSave);

        return NextResponse.json({
            success: true,
            message: "Keys and settings synced from matrix core to local storage successfully.",
            syncedKeys: {
                openai: !!openaiApiKey,
                elevenlabs: !!elevenlabsApiKey,
                gemini: !!geminiApiKey
            }
        });

    } catch (error) {
        console.error("Admin sync error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
