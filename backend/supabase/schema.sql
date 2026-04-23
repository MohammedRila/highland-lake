-- Enable the pgcrypto extension to work with UUIDs securely
create extension if not exists "uuid-ossp";

-- 1. Leads Table
create table if not exists public.leads (
    id uuid primary key default uuid_generate_v4(),
    name text,
    phone text not null unique,
    first_contact timestamp with time zone default now(),
    last_contact timestamp with time zone,
    status text default 'new', -- new | active | booked | complete | lapsed
    source text default 'sms', -- sms | missed_call | reactivation
    notes text
);

-- 2. Conversations Table
create table if not exists public.conversations (
    id uuid primary key default uuid_generate_v4(),
    lead_id uuid references public.leads(id) on delete cascade,
    direction text not null check (direction in ('inbound', 'outbound')),
    message text not null,
    sent_at timestamp with time zone default now(),
    read boolean default false
);

-- 3. Jobs Table
create table if not exists public.jobs (
    id uuid primary key default uuid_generate_v4(),
    lead_id uuid references public.leads(id) on delete cascade,
    service text,
    job_date date,
    status text default 'scheduled', -- scheduled | complete | cancelled
    review_sent boolean default false,
    completed_at timestamp with time zone
);

-- Recommended Indexing for performance
create index if not exists idx_leads_phone on public.leads(phone);
create index if not exists idx_conversations_lead_id on public.conversations(lead_id);
create index if not exists idx_jobs_lead_id on public.jobs(lead_id);

-- 4. Audit Logs Table
create table if not exists public.audit_logs (
    id uuid primary key default uuid_generate_v4(),
    actor_id text,
    actor_type text default 'system',
    action text not null,
    target_type text not null,
    target_id text,
    metadata jsonb default '{}'::jsonb,
    created_at timestamp with time zone default now()
);

create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);
create index if not exists idx_audit_logs_action on public.audit_logs(action);

-- 5. Webhook Event Dedupe Table
create table if not exists public.webhook_events (
    id uuid primary key default uuid_generate_v4(),
    provider text not null,
    event_id text not null,
    status text default 'processed',
    payload jsonb default '{}'::jsonb,
    error_message text,
    processed_at timestamp with time zone,
    created_at timestamp with time zone default now(),
    unique(provider, event_id)
);

create index if not exists idx_webhook_events_provider_created_at on public.webhook_events(provider, created_at desc);
