begin;

create table if not exists public.activity_events (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id uuid not null,
  device_label text,
  day date not null,
  seconds integer not null check (seconds > 0 and seconds <= 86400),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  kind text not null default 'study',
  label text,
  created_at timestamptz not null default now(),
  check (ended_at >= started_at)
);

create table if not exists public.daily_activity (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id uuid not null,
  device_label text,
  day date not null,
  active_seconds integer not null default 0 check (active_seconds >= 0),
  sessions integer not null default 0 check (sessions >= 0),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id, day)
);

create table if not exists public.quiz_attempts (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id uuid not null,
  device_label text,
  mode text not null,
  title text,
  subject text,
  completed_at timestamptz not null,
  elapsed_seconds integer not null default 0 check (elapsed_seconds >= 0),
  correct integer not null default 0 check (correct >= 0),
  total integer not null default 0 check (total >= 0),
  percentage integer,
  projected integer,
  math_scaled integer,
  rw_scaled integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_events_user_day_idx
  on public.activity_events (user_id, day);

create index if not exists activity_events_user_ended_idx
  on public.activity_events (user_id, ended_at desc);

create index if not exists daily_activity_user_day_idx
  on public.daily_activity (user_id, day);

create index if not exists quiz_attempts_user_completed_idx
  on public.quiz_attempts (user_id, completed_at desc);

alter table public.activity_events enable row level security;
alter table public.daily_activity enable row level security;
alter table public.quiz_attempts enable row level security;

drop policy if exists activity_events_select_own on public.activity_events;
create policy activity_events_select_own
  on public.activity_events
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists daily_activity_select_own on public.daily_activity;
create policy daily_activity_select_own
  on public.daily_activity
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists quiz_attempts_select_own on public.quiz_attempts;
create policy quiz_attempts_select_own
  on public.quiz_attempts
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.activity_events from anon, authenticated;
revoke all on public.daily_activity from anon, authenticated;
revoke all on public.quiz_attempts from anon, authenticated;

grant select on public.activity_events to authenticated;
grant select on public.daily_activity to authenticated;
grant select on public.quiz_attempts to authenticated;

create or replace function public.record_activity_events(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e jsonb;
  v_user uuid := auth.uid();
  v_id text;
  v_device uuid;
  v_device_label text;
  v_day date;
  v_seconds integer;
  v_started timestamptz;
  v_ended timestamptz;
  v_kind text;
  v_label text;
  v_inserted integer;
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a JSON array';
  end if;

  for e in select value from jsonb_array_elements(p_events)
  loop
    begin
      v_id := nullif(e->>'id', '');
      v_device := (e->>'device_id')::uuid;
      v_device_label := nullif(e->>'device_label', '');
      v_day := (e->>'day')::date;
      v_seconds := (e->>'seconds')::integer;
      v_started := (e->>'started_at')::timestamptz;
      v_ended := (e->>'ended_at')::timestamptz;
      v_kind := coalesce(nullif(e->>'kind', ''), 'study');
      v_label := nullif(e->>'label', '');
    exception
      when others then
        continue;
    end;

    if v_id is null
      or v_device is null
      or v_day is null
      or v_seconds is null
      or v_seconds <= 0
      or v_seconds > 86400
      or v_started is null
      or v_ended is null
      or v_ended < v_started
    then
      continue;
    end if;

    insert into public.activity_events (
      id,
      user_id,
      device_id,
      device_label,
      day,
      seconds,
      started_at,
      ended_at,
      kind,
      label
    )
    values (
      v_id,
      v_user,
      v_device,
      v_device_label,
      v_day,
      v_seconds,
      v_started,
      v_ended,
      v_kind,
      v_label
    )
    on conflict (id) do nothing;

    get diagnostics v_inserted = row_count;

    if v_inserted = 1 then
      insert into public.daily_activity (
        user_id,
        device_id,
        device_label,
        day,
        active_seconds,
        sessions,
        first_seen_at,
        last_seen_at,
        updated_at
      )
      values (
        v_user,
        v_device,
        v_device_label,
        v_day,
        v_seconds,
        1,
        v_started,
        v_ended,
        now()
      )
      on conflict (user_id, device_id, day) do update
      set
        active_seconds = public.daily_activity.active_seconds + excluded.active_seconds,
        sessions = public.daily_activity.sessions + 1,
        device_label = coalesce(excluded.device_label, public.daily_activity.device_label),
        first_seen_at = least(public.daily_activity.first_seen_at, excluded.first_seen_at),
        last_seen_at = greatest(public.daily_activity.last_seen_at, excluded.last_seen_at),
        updated_at = now();

      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

create or replace function public.record_quiz_attempts(p_attempts jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a jsonb;
  v_user uuid := auth.uid();
  v_id text;
  v_device uuid;
  v_device_label text;
  v_mode text;
  v_title text;
  v_subject text;
  v_completed timestamptz;
  v_elapsed integer;
  v_correct integer;
  v_total integer;
  v_percentage integer;
  v_projected integer;
  v_math integer;
  v_rw integer;
  v_payload jsonb;
  v_inserted integer;
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  if p_attempts is null or jsonb_typeof(p_attempts) <> 'array' then
    raise exception 'p_attempts must be a JSON array';
  end if;

  for a in select value from jsonb_array_elements(p_attempts)
  loop
    begin
      v_id := nullif(a->>'id', '');
      v_device := (a->>'device_id')::uuid;
      v_device_label := nullif(a->>'device_label', '');
      v_mode := nullif(a->>'mode', '');
      v_title := nullif(a->>'title', '');
      v_subject := nullif(a->>'subject', '');
      v_completed := (a->>'completed_at')::timestamptz;
      v_elapsed := coalesce((a->>'elapsed_seconds')::integer, 0);
      v_correct := coalesce((a->>'correct')::integer, 0);
      v_total := coalesce((a->>'total')::integer, 0);
      v_percentage := nullif(a->>'percentage', '')::integer;
      v_projected := nullif(a->>'projected', '')::integer;
      v_math := nullif(a->>'math_scaled', '')::integer;
      v_rw := nullif(a->>'rw_scaled', '')::integer;
      v_payload := coalesce(a->'payload', '{}'::jsonb);
    exception
      when others then
        continue;
    end;

    if v_id is null
      or v_device is null
      or v_mode is null
      or v_completed is null
      or v_elapsed < 0
      or v_correct < 0
      or v_total < 0
    then
      continue;
    end if;

    insert into public.quiz_attempts (
      id,
      user_id,
      device_id,
      device_label,
      mode,
      title,
      subject,
      completed_at,
      elapsed_seconds,
      correct,
      total,
      percentage,
      projected,
      math_scaled,
      rw_scaled,
      payload
    )
    values (
      v_id,
      v_user,
      v_device,
      v_device_label,
      v_mode,
      v_title,
      v_subject,
      v_completed,
      v_elapsed,
      v_correct,
      v_total,
      v_percentage,
      v_projected,
      v_math,
      v_rw,
      v_payload
    )
    on conflict (id) do nothing;

    get diagnostics v_inserted = row_count;

    if v_inserted = 1 then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.record_activity_events(jsonb) from public, anon;
revoke all on function public.record_quiz_attempts(jsonb) from public, anon;

grant execute on function public.record_activity_events(jsonb) to authenticated;
grant execute on function public.record_quiz_attempts(jsonb) to authenticated;

commit;
