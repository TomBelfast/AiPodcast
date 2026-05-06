alter table public.user_settings
  add column if not exists gemini_api_key text;
