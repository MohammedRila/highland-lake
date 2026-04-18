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
