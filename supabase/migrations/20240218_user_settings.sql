-- Create a table for user settings
create table if not exists public.user_settings (
  user_id uuid references auth.users not null primary key,
  openai_api_key text,
  elevenlabs_api_key text,
  main_prompt text,
  polish_ending_prompt text,
  host_prompt_polish text,
  host_prompt_other text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Set up Row Level Security (RLS)
alter table public.user_settings enable row level security;

-- Create policies
create policy "Users can view their own settings" on public.user_settings
  for select using (auth.uid() = user_id);

create policy "Users can insert their own settings" on public.user_settings
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own settings" on public.user_settings
  for update using (auth.uid() = user_id);

-- Optional: Create a function to handle new user creation automatically?
-- For now, we'll handle it on the client side (upsert).
