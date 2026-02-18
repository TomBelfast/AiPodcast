'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface AuthGuardProps {
    children: React.ReactNode;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
    const [session, setSession] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [accessDenied, setAccessDenied] = useState(false);

    // Application ID from env
    const appId = process.env.NEXT_PUBLIC_APP_ID || 'global';

    useEffect(() => {
        const checkAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();

            if (session) {
                // Optional permission check logic from the user's snippet
                const { data, error } = await supabase
                    .from('user_permissions')
                    .select('*')
                    .eq('user_id', session.user.id)
                    .eq('app_id', appId)
                    .eq('is_active', true)
                    .single();

                if (error || !data) {
                    console.warn(`[Auth] No specific permissions for app: ${appId} (this is a soft check)`);
                }
            }

            setSession(session);
            setLoading(false);
        };

        checkAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            if (!session) setAccessDenied(false);
        });

        return () => subscription.unsubscribe();
    }, [appId]);

    const handleMagicLink = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage('');

        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
                emailRedirectTo: `${window.location.origin}`,
            },
        });

        if (error) {
            setMessage(`ERROR: ${error.message}`);
        } else {
            setMessage('ACCESS LINK DISPATCHED TO COMMLINK (EMAIL).');
        }
        setLoading(false);
    };

    const handleGoogleLogin = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin
            }
        });
        if (error) {
            setMessage(`ERROR: ${error.message}`);
        }
    };

    if (loading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-black font-mono text-green-500">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-16 w-16 animate-spin rounded-full border-4 border-green-900 border-t-green-500"></div>
                    <div className="animate-pulse text-xl tracking-[0.2em] text-green-400">INITIALISING MATRIX...</div>
                </div>
            </div>
        );
    }

    if (accessDenied) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center p-6 text-center font-mono">
                <div className="relative z-10 w-full max-w-md transform overflow-hidden rounded-xl border border-red-500/50 bg-black/80 p-12 backdrop-blur-xl">
                    <h1 className="text-4xl font-bold text-red-500 mb-4 tracking-tighter">ACCESS DENIED</h1>
                    <p className="text-white/60 uppercase font-bold text-sm">Your profile lacks authorization for module: <span className="text-red-400">{appId}</span></p>
                    <button onClick={() => supabase.auth.signOut()} className="mt-8 text-white/40 hover:text-white uppercase text-[10px] tracking-widest underline transition-colors">
                        Terminating Session
                    </button>
                </div>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-black font-mono text-green-500 selection:bg-green-900 selection:text-green-100">
                {/* Matrix Rain Background Effect */}
                <div className="absolute inset-0 opacity-20"
                    style={{
                        backgroundImage: 'linear-gradient(0deg, transparent 24%, rgba(0, 255, 0, .3) 25%, rgba(0, 255, 0, .3) 26%, transparent 27%, transparent 74%, rgba(0, 255, 0, .3) 75%, rgba(0, 255, 0, .3) 76%, transparent 77%, transparent), linear-gradient(90deg, transparent 24%, rgba(0, 255, 0, .3) 25%, rgba(0, 255, 0, .3) 26%, transparent 27%, transparent 74%, rgba(0, 255, 0, .3) 75%, rgba(0, 255, 0, .3) 76%, transparent 77%, transparent)',
                        backgroundSize: '50px 50px'
                    }}>
                </div>

                <div className="relative z-10 w-full max-w-md transform overflow-hidden rounded-xl border border-green-500/30 bg-black/90 p-8 shadow-[0_0_50px_rgba(0,255,0,0.15)] backdrop-blur-xl transition-all duration-500 hover:border-green-500/50 hover:shadow-[0_0_80px_rgba(0,255,0,0.25)]">
                    <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-transparent pointer-events-none" />

                    <div className="mb-8 text-center">
                        <h1 className="text-4xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-600 drop-shadow-[0_0_10px_rgba(0,255,0,0.5)]">
                            SYSTEM GATE
                        </h1>
                        <p className="mt-2 text-xs uppercase tracking-[0.3em] text-green-700">Restricted Access // Level 5</p>
                    </div>

                    <div className="space-y-6 relative z-20">
                        {/* Google Login Button */}
                        <button
                            onClick={handleGoogleLogin}
                            className="w-full relative overflow-hidden rounded bg-white text-slate-900 p-4 font-bold uppercase tracking-wider shadow-lg flex items-center justify-center gap-3 transition-all duration-300 hover:bg-slate-200 hover:shadow-[0_0_20px_rgba(255,255,255,0.4)] active:scale-[0.98] group"
                        >
                            <svg className="w-5 h-5 group-hover:scale-110 transition-transform" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.901 3.251-2.02 4.141C16.89 19.339 14.86 20 12 20c-4.96 0-9-4.04-9-9s4.04-9 9-9c2.97 0 5.23 1.11 6.94 2.7l2.46-2.46C18.99 1.56 15.82 0 12 0 5.38 0 0 5.38 0 12s5.38 12 12 12c3.55 0 6.21-1.17 8.24-3.3 2.08-2.08 2.76-4.99 2.76-7.38 0-.46-.04-.92-.12-1.4h-10.4z" />
                            </svg>
                            <span>Login via OpenAI (Google)</span>
                        </button>

                        <div className="flex items-center gap-4">
                            <div className="h-px flex-1 bg-green-900/50"></div>
                            <span className="text-[10px] uppercase text-green-800 font-bold">Or Identify via Protocol</span>
                            <div className="h-px flex-1 bg-green-900/50"></div>
                        </div>

                        {/* Magic Link Form */}
                        <form onSubmit={handleMagicLink} className="space-y-4">
                            <div className="group">
                                <div className="relative">
                                    <input
                                        id="email"
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full rounded bg-green-950/20 px-4 py-3 text-green-400 placeholder-green-800/50 outline-none ring-1 ring-green-900 transition-all focus:bg-green-950/40 focus:ring-green-500 focus:drop-shadow-[0_0_8px_rgba(0,255,0,0.3)]"
                                        placeholder="agent@matrix.create"
                                    />
                                    <div className="absolute right-3 top-3 h-2 w-2 rounded-full bg-green-500 shadow-[0_0_5px_rgba(0,255,0,0.8)] animate-pulse" />
                                </div>
                            </div>

                            {message && (
                                <div className="mx-auto rounded border border-green-500/30 bg-green-900/10 p-3 text-center text-xs font-medium text-green-300 backdrop-blur-sm">
                                    {message}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full relative overflow-hidden rounded bg-transparent border border-green-600 text-green-400 p-3 font-bold uppercase tracking-widest transition-all hover:bg-green-600 hover:text-black hover:shadow-[0_0_15px_rgba(0,255,0,0.4)] active:scale-[0.98] disabled:opacity-50"
                            >
                                Send Magic Link
                            </button>
                        </form>
                    </div>

                    <div className="mt-8 flex justify-center space-x-4 border-t border-green-900/30 pt-6">
                        <div className="text-[10px] text-green-800 uppercase tracking-widest">
                            Secured by Supabase // Node: {appId}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Helper to expose logout to children if needed via context, or just simple wrap
    return (
        <div className="relative min-h-screen">
            {children}
        </div>
    );
};
