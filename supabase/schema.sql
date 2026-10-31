-- Run once in Supabase Dashboard > SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  image_quota int not null default 200,
  images_used int not null default 0,
  is_blocked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_user_type_idx on public.usage_events (user_id, type, created_at);

-- Users can only read their own profile; all writes go through the server (service role).
alter table public.profiles enable row level security;
alter table public.usage_events enable row level security;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (auth.uid() = id);

-- Auto-create a profile for every new user.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill users created before this script ran.
insert into public.profiles (id, email) select id, email from auth.users on conflict do nothing;

-- Atomic credit reservation: cannot overshoot the quota under concurrency.
create or replace function public.consume_image_credit(p_user uuid)
returns table (ok boolean, used int, quota int)
language plpgsql security definer set search_path = public as $$
begin
  return query
    with upd as (
      update public.profiles p set images_used = p.images_used + 1
      where p.id = p_user and not p.is_blocked and p.images_used < p.image_quota
      returning p.images_used, p.image_quota
    )
    select true, upd.images_used, upd.image_quota from upd;
  if not found then
    return query select false, p.images_used, p.image_quota from public.profiles p where p.id = p_user;
  end if;
end $$;

create or replace function public.refund_image_credit(p_user uuid) returns void
language sql security definer set search_path = public as $$
  update public.profiles set images_used = greatest(images_used - 1, 0) where id = p_user;
$$;

revoke all on function public.consume_image_credit(uuid) from public, anon, authenticated;
revoke all on function public.refund_image_credit(uuid) from public, anon, authenticated;
grant execute on function public.consume_image_credit(uuid) to service_role;
grant execute on function public.refund_image_credit(uuid) to service_role;

-- Dashboard: one row per user (query in the SQL editor or Table editor).
create or replace view public.user_stats with (security_invoker = true) as
select
  p.id, p.email, p.images_used, p.image_quota, p.is_blocked, p.created_at,
  count(*) filter (where e.type = 'session_start') as app_sessions,
  count(*) filter (where e.type = 'listening_start') as listening_sessions,
  coalesce(sum((e.meta->>'seconds')::int) filter (where e.type = 'reading_heartbeat'), 0) as reading_seconds,
  max(e.created_at) as last_seen
from public.profiles p
left join public.usage_events e on e.user_id = p.id
group by p.id;
