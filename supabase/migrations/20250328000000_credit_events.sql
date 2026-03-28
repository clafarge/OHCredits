-- OHCredits: one row per show / event code. Public read for the player; writes only via
-- Edge Function (service role), never with the anon key in the browser.

create table if not exists public.credit_events (
  event_code text primary key,
  design jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists credit_events_updated_at_idx on public.credit_events (updated_at desc);

alter table public.credit_events enable row level security;

create policy "credit_events_select_public"
  on public.credit_events
  for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policies for anon — publishing uses service_role in Edge Function.
