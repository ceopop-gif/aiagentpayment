-- AnyPay Omnichannel Sales Messaging
-- Connects customer conversations from supported messaging APIs into one AI sales inbox.

create extension if not exists pgcrypto;

create table if not exists public.messaging_channels (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid null references public.stores(id) on delete set null,
  provider text not null check (provider in ('LINE','FACEBOOK','INSTAGRAM','WHATSAPP','TELEGRAM','WEBCHAT','WECHAT','OTHER')),
  external_account_id text not null,
  display_name text,
  status text not null default 'PENDING' check (status in ('PENDING','ACTIVE','PAUSED','ERROR','DISCONNECTED')),
  ai_mode text not null default 'DRAFT' check (ai_mode in ('OFF','DRAFT','AUTO')),
  public_config jsonb not null default '{}'::jsonb,
  access_token_secret_id text,
  app_secret_secret_id text,
  verify_token_secret_id text,
  channel_secret_secret_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(merchant_id, provider, external_account_id)
);

create table if not exists public.omni_contacts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete set null,
  display_name text,
  phone text,
  email text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.omni_contact_identities (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  contact_id uuid not null references public.omni_contacts(id) on delete cascade,
  channel_id uuid not null references public.messaging_channels(id) on delete cascade,
  provider text not null,
  external_user_id text not null,
  external_username text,
  profile jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique(channel_id, external_user_id)
);

create table if not exists public.omni_conversations (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid null references public.stores(id) on delete set null,
  channel_id uuid not null references public.messaging_channels(id) on delete cascade,
  contact_id uuid not null references public.omni_contacts(id) on delete cascade,
  identity_id uuid not null references public.omni_contact_identities(id) on delete cascade,
  status text not null default 'OPEN' check (status in ('OPEN','WAITING_CUSTOMER','WAITING_STAFF','RESOLVED','ARCHIVED')),
  ai_mode text not null default 'DRAFT' check (ai_mode in ('OFF','DRAFT','AUTO')),
  assigned_user_id uuid null references auth.users(id) on delete set null,
  sales_stage text not null default 'NEW' check (sales_stage in ('NEW','QUALIFYING','RECOMMENDED','CHECKOUT_SENT','PAYMENT_PENDING','PAID','LOST')),
  context jsonb not null default '{}'::jsonb,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel_id, identity_id)
);

create table if not exists public.omni_messages (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  conversation_id uuid not null references public.omni_conversations(id) on delete cascade,
  channel_id uuid not null references public.messaging_channels(id) on delete cascade,
  provider_message_id text,
  direction text not null check (direction in ('IN','OUT')),
  sender_type text not null check (sender_type in ('CUSTOMER','AI','STAFF','SYSTEM')),
  message_type text not null default 'TEXT' check (message_type in ('TEXT','IMAGE','VIDEO','AUDIO','FILE','LOCATION','STICKER','POSTBACK','OTHER')),
  text_content text,
  media jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  ai_generated boolean not null default false,
  delivery_status text not null default 'RECEIVED' check (delivery_status in ('RECEIVED','QUEUED','SENT','DELIVERED','READ','FAILED')),
  created_at timestamptz not null default now(),
  unique(channel_id, provider_message_id)
);

create table if not exists public.omni_sales_attribution (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid null references public.stores(id) on delete set null,
  conversation_id uuid not null references public.omni_conversations(id) on delete cascade,
  channel_id uuid not null references public.messaging_channels(id) on delete cascade,
  contact_id uuid not null references public.omni_contacts(id) on delete cascade,
  salepage_id uuid null references public.salepages(id) on delete set null,
  order_id uuid null references public.orders(id) on delete set null,
  payment_transaction_id uuid null references public.payment_transactions(id) on delete set null,
  source_message_id uuid null references public.omni_messages(id) on delete set null,
  amount numeric(12,2),
  currency text not null default 'THB',
  status text not null default 'ATTRIBUTED' check (status in ('ATTRIBUTED','CHECKOUT_SENT','PAID','CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messaging_channels_merchant_provider on public.messaging_channels(merchant_id, provider, status);
create index if not exists idx_omni_contacts_merchant on public.omni_contacts(merchant_id, updated_at desc);
create index if not exists idx_omni_identities_external on public.omni_contact_identities(channel_id, external_user_id);
create index if not exists idx_omni_conversations_merchant_recent on public.omni_conversations(merchant_id, last_message_at desc);
create index if not exists idx_omni_messages_conversation_time on public.omni_messages(conversation_id, created_at asc);
create index if not exists idx_omni_attribution_conversation on public.omni_sales_attribution(conversation_id, created_at desc);

create or replace function public.touch_omni_conversation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.omni_conversations
     set updated_at = now(), last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_omni_conversation on public.omni_messages;
create trigger trg_touch_omni_conversation
after insert on public.omni_messages
for each row execute function public.touch_omni_conversation();

alter table public.messaging_channels enable row level security;
alter table public.omni_contacts enable row level security;
alter table public.omni_contact_identities enable row level security;
alter table public.omni_conversations enable row level security;
alter table public.omni_messages enable row level security;
alter table public.omni_sales_attribution enable row level security;

-- Browser users can view only merchants they belong to. Credential fields remain secret references, not raw tokens.
do $$
declare t text;
begin
  foreach t in array array['messaging_channels','omni_contacts','omni_contact_identities','omni_conversations','omni_messages','omni_sales_attribution'] loop
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format($p$
      create policy %I_member_select on public.%I for select using (
        exists (select 1 from public.merchant_members mm where mm.merchant_id = %I.merchant_id and mm.user_id = auth.uid())
      )
    $p$, t, t, t);
  end loop;
end $$;

comment on table public.messaging_channels is 'Connected customer messaging accounts. Raw API credentials are stored only in integration_secrets.';
comment on table public.omni_conversations is 'Unified customer sales conversations across LINE, Meta, WhatsApp, Telegram, web chat and future adapters.';
comment on table public.omni_messages is 'Append-only normalized messaging events for the omnichannel AI sales inbox.';
comment on table public.omni_sales_attribution is 'Links a messaging conversation to SalePage, Order and verified Payment outcomes.';
