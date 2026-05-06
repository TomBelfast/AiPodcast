'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface UserSettings {
    openai_api_key?: string;
    elevenlabs_api_key?: string;
    gemini_api_key?: string;
    main_prompt?: string;
    polish_ending_prompt?: string;
    host_prompt_polish?: string;
    host_prompt_other?: string;
}

interface UserSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (settings: UserSettings) => void;
    initialSettings?: UserSettings;
    initialMessage?: string | null;
}

export const UserSettingsModal: React.FC<UserSettingsModalProps> = ({
    isOpen,
    onClose,
    onSave,
    initialSettings,
    initialMessage,
}) => {
    const [settings, setSettings] = useState<UserSettings>(initialSettings || {});
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(initialMessage || '');
    const [activeField, setActiveField] = useState<keyof UserSettings | null>(null);

    // Update local state when initialSettings change
    useEffect(() => {
        if (initialSettings) {
            setSettings(initialSettings);
        }
    }, [initialSettings]);

    // Update message when initialMessage changes
    useEffect(() => {
        setMessage(initialMessage || '');
    }, [initialMessage]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setSettings((prev) => ({ ...prev, [name]: value }));
    };

    const handleSave = async () => {
        setLoading(true);
        setMessage('');

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('No active session');
            }

            // Upsert settings to Supabase
            const { error } = await supabase
                .from('user_settings')
                .upsert({
                    user_id: session.user.id,
                    ...settings,
                    updated_at: new Date().toISOString(),
                });

            if (error) throw error;

            onSave(settings);
            setMessage('SETTINGS SAVED TO MATRIX CORE.');
            setTimeout(() => {
                setMessage('');
                onClose();
            }, 1500);
        } catch (error: unknown) {
            console.error('Error saving settings:', error);
            const message = error instanceof Error ? error.message : 'FAILED TO SAVE';
            setMessage(`ERROR: ${message}`);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    // FIELD LABELS MAP
    const fieldLabels: Record<keyof UserSettings, string> = {
        openai_api_key: 'LLM Provider Key',
        elevenlabs_api_key: 'ElevenLabs Voice Key',
        gemini_api_key: 'Gemini TTS Key',
        main_prompt: 'System Prompt (Main Guidelines)',
        host_prompt_polish: 'Host Persona (Polish)',
        host_prompt_other: 'Host Persona (General)',
        polish_ending_prompt: 'Ending Protocol (Polish)'
    };

    // FULLSCREEN EDITOR OVERLAY
    if (activeField) {
        return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-xl p-6">
                <div className="w-full h-full max-w-[1920px] flex flex-col gap-6">
                    {/* Fullscreen Header */}
                    <div className="flex items-center justify-between border-b border-white/10 pb-6">
                        <div>
                            <h2 className="text-4xl font-bold tracking-widest text-green-500 uppercase">
                                {fieldLabels[activeField]}
                            </h2>
                            <p className="text-sm text-zinc-500 uppercase tracking-widest mt-2">
                                Fullscreen Editor Mode
                            </p>
                        </div>
                        <button
                            onClick={() => setActiveField(null)}
                            className="px-8 py-3 rounded bg-green-900/30 border border-green-500/50 text-green-400 hover:bg-green-500 hover:text-black hover:shadow-[0_0_20px_rgba(0,255,0,0.4)] transition-all uppercase text-sm font-bold tracking-widest"
                        >
                            Close Editor
                        </button>
                    </div>

                    {/* Fullscreen Textarea */}
                    <textarea
                        name={activeField}
                        value={settings[activeField] || ''}
                        onChange={handleChange}
                        className="flex-1 w-full bg-[#181818] border border-white/10 rounded-xl p-8 text-white text-xl font-mono leading-relaxed focus:border-green-500 focus:shadow-[0_0_30px_rgba(74,222,128,0.1)] outline-none transition-all placeholder-zinc-800 resize-none selection:bg-green-500/30"
                        placeholder={`Edit ${fieldLabels[activeField]}...`}
                        autoFocus
                    />
                    <div className="text-xs text-zinc-600 font-mono">
                        PRESS ESC TO CLOSE • CHANGES ARE SAVED TO DRAFT AUTOMATICALLY
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="relative w-full max-w-7xl max-h-[95vh] overflow-y-auto bg-[#1f1f1f] border border-white/10 rounded-xl shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10 bg-[#1f1f1f] sticky top-0 z-10 backdrop-blur-md">
                    <div>
                        <h2 className="text-3xl font-bold tracking-widest text-green-500 uppercase">
                            System Configuration
                        </h2>
                        <p className="text-xs text-green-800 uppercase tracking-wider">
                            User Override Protocols
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-green-700 hover:text-green-400 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="p-10 font-mono grid grid-cols-1 lg:grid-cols-2 gap-12">
                    {/* LEFT COLUMN: System Access & Core Logic */}
                    <div className="space-y-10">
                        {/* API Keys Section */}
                        <div className="space-y-8">
                            <h3 className="text-2xl font-bold text-white uppercase border-b border-white/10 pb-4 flex justify-between items-center">
                                <span className="text-green-500">Neural Network Access</span>
                                <span className="text-xs text-zinc-500">REQUIRED</span>
                            </h3>

                            <div className="space-y-6">
                                {/* OpenAI / OpenRouter Key */}
                                <div className="space-y-3 group">
                                    <div className="flex justify-between items-end">
                                        <label className="text-base text-green-500 uppercase font-bold tracking-wider group-focus-within:text-green-400 transition-colors">
                                            LLM Provider Key
                                        </label>
                                        <div className="flex gap-4 text-xs">
                                            <a
                                                href="https://platform.openai.com/api-keys"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-zinc-400 hover:text-green-400 transition-all hover:underline"
                                            >
                                                GET OPENAI
                                            </a>
                                            <span className="text-zinc-600">|</span>
                                            <a
                                                href="https://openrouter.ai/keys"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-zinc-400 hover:text-green-400 transition-all hover:underline"
                                            >
                                                GET OPENROUTER
                                            </a>
                                        </div>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="password"
                                            name="openai_api_key"
                                            value={settings.openai_api_key || ''}
                                            onChange={handleChange}
                                            placeholder="sk-... or sk-or-..."
                                            className="w-full bg-black/40 border border-white/10 rounded-lg p-5 text-white text-lg focus:border-green-500 focus:shadow-[0_0_20px_rgba(74,222,128,0.1)] outline-none transition-all placeholder-zinc-700 font-mono"
                                        />
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-green-500/20 group-focus-within:bg-green-500 shadow-[0_0_10px_rgba(74,222,128,0.5)] transition-all" />
                                    </div>
                                    <p className="text-xs text-zinc-500">
                                        Supports OpenAI (sk-...) or OpenRouter (sk-or-...).
                                    </p>
                                </div>

                                {/* ElevenLabs Key */}
                                <div className="space-y-3 group">
                                    <div className="flex justify-between items-end">
                                        <label className="text-base text-green-500 uppercase font-bold tracking-wider group-focus-within:text-green-400 transition-colors">
                                            ElevenLabs Voice Key
                                        </label>
                                        <a
                                            href="https://elevenlabs.io/app/settings/api-keys"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-zinc-400 hover:text-green-400 transition-all hover:underline"
                                        >
                                            GET ELEVENLABS KEY
                                        </a>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="password"
                                            name="elevenlabs_api_key"
                                            value={settings.elevenlabs_api_key || ''}
                                            onChange={handleChange}
                                            placeholder="xi-..."
                                            className="w-full bg-black/40 border border-white/10 rounded-lg p-5 text-white text-lg focus:border-green-500 focus:shadow-[0_0_20px_rgba(74,222,128,0.1)] outline-none transition-all placeholder-zinc-700 font-mono"
                                        />
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-green-500/20 group-focus-within:bg-green-500 shadow-[0_0_10px_rgba(74,222,128,0.5)] transition-all" />
                                    </div>
                                    <p className="text-xs text-zinc-500">
                                        Required for ElevenLabs voices.
                                    </p>
                                </div>

                                <div className="space-y-3 group">
                                    <div className="flex justify-between items-end">
                                        <label className="text-base text-green-500 uppercase font-bold tracking-wider group-focus-within:text-green-400 transition-colors">
                                            Gemini TTS Key
                                        </label>
                                        <a
                                            href="https://aistudio.google.com/apikey"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-zinc-400 hover:text-green-400 transition-all hover:underline"
                                        >
                                            GET GEMINI KEY
                                        </a>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="password"
                                            name="gemini_api_key"
                                            value={settings.gemini_api_key || ''}
                                            onChange={handleChange}
                                            placeholder="AIza..."
                                            className="w-full bg-black/40 border border-white/10 rounded-lg p-5 text-white text-lg focus:border-green-500 focus:shadow-[0_0_20px_rgba(74,222,128,0.1)] outline-none transition-all placeholder-zinc-700 font-mono"
                                        />
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-green-500/20 group-focus-within:bg-green-500 shadow-[0_0_10px_rgba(74,222,128,0.5)] transition-all" />
                                    </div>
                                    <p className="text-xs text-zinc-500">
                                        Required for Gemini TTS. Add only the providers you want to use.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* System Prompt */}
                        <div className="space-y-8">
                            <h3 className="text-2xl font-bold text-white uppercase border-b border-white/10 pb-4">
                                <span className="text-green-500">Core Configuration</span>
                            </h3>
                            <div className="space-y-3">
                                <label className="text-base text-green-500 uppercase font-bold tracking-wider">
                                    System Prompt (Main Guidelines)
                                </label>
                                <textarea
                                    name="main_prompt"
                                    value={settings.main_prompt || ''}
                                    onChange={handleChange}
                                    rows={8}
                                    className="w-full bg-black/40 border border-white/10 rounded-lg p-5 text-white text-lg focus:border-green-500 focus:shadow-[0_0_15px_rgba(74,222,128,0.1)] outline-none transition-all placeholder-zinc-700 leading-relaxed"
                                    placeholder="Define core behavior, tone, and rules..."
                                    onClick={() => setActiveField('main_prompt')}
                                />
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Personalities & Ending */}
                    <div className="space-y-10">
                        <h3 className="text-2xl font-bold text-white uppercase border-b border-white/10 pb-4">
                            <span className="text-green-500">Personalities & Flow</span>
                        </h3>

                        <div className="space-y-6">
                            <div className="space-y-3">
                                <label className="text-base text-green-500 uppercase font-bold tracking-wider">
                                    Host Persona (Polish)
                                </label>
                                <textarea
                                    name="host_prompt_polish"
                                    value={settings.host_prompt_polish || ''}
                                    onChange={handleChange}
                                    rows={5}
                                    className="w-full bg-black/40 border border-white/10 rounded-lg p-5 text-white text-lg focus:border-green-500 focus:shadow-[0_0_15px_rgba(74,222,128,0.1)] outline-none transition-all placeholder-zinc-700 leading-relaxed"
                                    placeholder="Define specific Polish personalities..."
                                    onClick={() => setActiveField('host_prompt_polish')}
                                />
                            </div>

                            <div className="space-y-3">
                                <label className="text-base text-green-500 uppercase font-bold tracking-wider">
                                    Host Persona (General)
                                </label>
                                <textarea
                                    name="host_prompt_other"
                                    value={settings.host_prompt_other || ''}
                                    onChange={handleChange}
                                    rows={5}
                                    className="w-full bg-black/40 border border-white/10 rounded-lg p-5 text-white text-lg focus:border-green-500 focus:shadow-[0_0_15px_rgba(74,222,128,0.1)] outline-none transition-all placeholder-zinc-700 leading-relaxed"
                                    placeholder="Define default personalities..."
                                    onClick={() => setActiveField('host_prompt_other')}
                                />
                            </div>

                            <div className="space-y-3">
                                <label className="text-base text-green-500 uppercase font-bold tracking-wider">
                                    Ending Protocol (Polish)
                                </label>
                                <textarea
                                    name="polish_ending_prompt"
                                    value={settings.polish_ending_prompt || ''}
                                    onChange={handleChange}
                                    rows={4}
                                    className="w-full bg-black/40 border border-white/10 rounded-lg p-5 text-white text-lg focus:border-green-500 focus:shadow-[0_0_15px_rgba(74,222,128,0.1)] outline-none transition-all placeholder-zinc-700 leading-relaxed"
                                    placeholder="Instructions for how the podcast should end..."
                                    onClick={() => setActiveField('polish_ending_prompt')}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-white/10 bg-[#1f1f1f] flex items-center justify-between sticky bottom-0 z-10">
                    <div className={`text-xs font-bold ${message.includes('MISSING') || message.includes('ERROR') ? 'text-red-500' : 'text-green-500'}`}>
                        {message && <span className="animate-pulse">{message}</span>}
                    </div>
                    <div className="flex gap-4">
                        <button
                            onClick={onClose}
                            className="px-6 py-2 rounded text-green-700 hover:text-green-400 hover:bg-green-900/20 transition-all uppercase text-xs font-bold tracking-widest"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={loading}
                            className="px-8 py-2 rounded bg-green-900/30 border border-green-500/50 text-green-400 hover:bg-green-500 hover:text-black hover:shadow-[0_0_20px_rgba(0,255,0,0.4)] transition-all uppercase text-xs font-bold tracking-widest disabled:opacity-50"
                        >
                            {loading ? 'Saving...' : 'Save Configuration'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
