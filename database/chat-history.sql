-- AnyPay Chat History
-- Production schema for persistent ChatGPT-style conversation history.
-- Conversations belong to a user and merchant. Messages are append-only.

create extension if not exists pgcrypto;

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid null references public.stores(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'แชตใหม่',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid null references public.stores(id) on delete set null,
  user_id uuid null references auth.users(id) on delete set null,
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null,
  intent text null,
  tool_name text null,
  action_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_conversations_user_merchant_updated
  on public.ai_conversations(user_id, merchant_id, updated_at desc);
create index if not exists idx_ai_conversations_store_updated
  on public.ai_conversations(store_id, updated_at desc);
create index if not exists idx_ai_messages_conversation_created
  on public.ai_messages(conversation_id, created_at asc);
create index if not exists idx_ai_messages_merchant_created
  on public.ai_messages(merchant_id, created_at desc);

create or replace function public.touch_ai_conversation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.ai_conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_ai_conversation on public.ai_messages;
create trigger trg_touch_ai_conversation
after insert on public.ai_messages
for each row execute function public.touch_ai_conversation();

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

-- A signed-in user can only see conversations for merchants they belong to.
drop policy if exists ai_conversations_select_member on public.ai_conversations;
create policy ai_conversations_select_member on public.ai_conversations
for select using (
  user_id = auth.uid()
  and exists (
    select 1 from public.merchant_members mm
    where mm.merchant_id = ai_conversations.merchant_id
      and mm.user_id = auth.uid()
  )
);

drop policy if exists ai_conversations_insert_member on public.ai_conversations;
create policy ai_conversations_insert_member on public.ai_conversations
for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.merchant_members mm
    where mm.merchant_id = ai_conversations.merchant_id
      and mm.user_id = auth.uid()
  )
);

drop policy if exists ai_conversations_update_owner on public.ai_conversations;
create policy ai_conversations_update_owner on public.ai_conversations
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ai_conversations_delete_owner on public.ai_conversations;
create policy ai_conversations_delete_owner on public.ai_conversations
for delete using (user_id = auth.uid());

drop policy if exists ai_messages_select_member on public.ai_messages;
create policy ai_messages_select_member on public.ai_messages
for select using (
  exists (
    select 1 from public.ai_conversations c
    where c.id = ai_messages.conversation_id
      and c.user_id = auth.uid()
  )
);

-- Browser may write only the signed-in user's own messages.
-- Assistant/tool/system messages should be written by the trusted backend/service role.
drop policy if exists ai_messages_insert_user on public.ai_messages;
create policy ai_messages_insert_user on public.ai_messages
for insert with check (
  role = 'user'
  and user_id = auth.uid()
  and exists (
    select 1 from public.ai_conversations c
    where c.id = ai_messages.conversation_id
      and c.user_id = auth.uid()
      and c.merchant_id = ai_messages.merchant_id
  )
);

comment on table public.ai_conversations is 'AnyPay persistent AI chat threads, scoped to user and merchant.';
comment on table public.ai_messages is 'Append-only AnyPay chat messages and optional AI action metadata.';
