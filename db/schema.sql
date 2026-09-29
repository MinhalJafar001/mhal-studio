-- Safe to run repeatedly: `npm run db:migrate`

CREATE TABLE IF NOT EXISTS leads (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  name        text NOT NULL,
  email       text NOT NULL,
  phone       text,
  service     text,
  message     text,
  source      text NOT NULL DEFAULT 'contact_form',
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'won', 'lost')),
  notes       text
);

CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);

-- v2: business details + Google Sheet sync
ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_name text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS position text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Stable ID of the sheet row a lead came from, so re-syncing updates instead of duplicating
ALTER TABLE leads ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS leads_external_id_key ON leads (external_id);

-- Sheet rows may only have a business name, or no email
ALTER TABLE leads ALTER COLUMN name DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN email DROP NOT NULL;

-- Source is 'website' (contact form) or 'manual' (Google Sheet / added by hand)
UPDATE leads SET source = 'website' WHERE source = 'contact_form';
ALTER TABLE leads ALTER COLUMN source SET DEFAULT 'website';
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check CHECK (source IN ('website', 'manual'));

-- v3: per-lead activity timeline (notes now; status changes logged automatically; emails/calls later)
CREATE TABLE IF NOT EXISTS lead_activity (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id     bigint NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL CHECK (kind IN ('note', 'status', 'email', 'call')),
  body        text,
  meta        jsonb
);

CREATE INDEX IF NOT EXISTS lead_activity_lead_idx ON lead_activity (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_status_idx ON leads (status);

-- v4: inbound replies (via Resend receiving). Each received email is logged at most once.
ALTER TABLE lead_activity DROP CONSTRAINT IF EXISTS lead_activity_kind_check;
ALTER TABLE lead_activity ADD CONSTRAINT lead_activity_kind_check CHECK (kind IN ('note', 'status', 'email', 'reply', 'call'));
CREATE UNIQUE INDEX IF NOT EXISTS lead_activity_inbound_key ON lead_activity ((meta->>'inbound_id')) WHERE kind = 'reply';
CREATE INDEX IF NOT EXISTS leads_email_lower_idx ON leads (lower(email));

-- v5: 'replied' status, set automatically when a lead replies (cleared when you email them back)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (status IN ('new', 'contacted', 'replied', 'won', 'lost'));

-- v7: Zoom Phone calls (dialer). One row per Zoom call; the log, AI summary and your notes can arrive in any order.
CREATE TABLE IF NOT EXISTS calls (
  call_id           text PRIMARY KEY,
  lead_id           bigint REFERENCES leads (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  direction         text CHECK (direction IN ('outbound', 'inbound')),
  number            text,
  result            text,
  outcome           text CHECK (outcome IN ('connected', 'voicemail', 'no_answer', 'busy', 'wrong_number', 'other')),
  outcome_source    text NOT NULL DEFAULT 'auto' CHECK (outcome_source IN ('auto', 'manual')),
  duration_seconds  integer,
  call_log_id       text,
  summary           text,
  next_steps        text,
  detailed_summary  text,
  notes             text
);

CREATE INDEX IF NOT EXISTS calls_lead_idx ON calls (lead_id, started_at DESC);
-- Match incoming numbers to leads on their last 10 digits (formatting-insensitive)
CREATE INDEX IF NOT EXISTS leads_phone_digits_idx ON leads ((right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)));

-- v11: dashboard settings (profile, signature, password hash, session epoch, last sheet sync)
CREATE TABLE IF NOT EXISTS settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- v10: 'interested' status (set from the Google Sheet's Interested column, or by hand)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (status IN ('new', 'contacted', 'replied', 'interested', 'won', 'lost'));

-- v8: calls placed from the dashboard via the Zoom desktop app (zoomphonecall://) are recorded as pending
-- (call_id = local_ref = 'dash-…') and merged with Zoom's server-side call record when its webhook arrives.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS local_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS calls_local_ref_key ON calls (local_ref);
ALTER TABLE calls ADD COLUMN IF NOT EXISTS zoom_logged boolean NOT NULL DEFAULT false;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_summary_id text;

-- v9: 'failed' outcome (Zoom result "call_failed")
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_outcome_check;
ALTER TABLE calls ADD CONSTRAINT calls_outcome_check CHECK (outcome IN ('connected', 'voicemail', 'no_answer', 'busy', 'failed', 'wrong_number', 'other'));
UPDATE calls SET outcome = 'failed' WHERE outcome_source = 'auto' AND lower(coalesce(result, '')) LIKE '%fail%';

-- Every Zoom webhook, stored raw so records can be re-processed if Zoom's payload format changes
CREATE TABLE IF NOT EXISTS zoom_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now(),
  request_id   text UNIQUE,
  event        text,
  payload      jsonb NOT NULL,
  error        text
);

-- v6: reusable email templates with {placeholders}
CREATE TABLE IF NOT EXISTS email_templates (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  name        text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL
);

-- Starter templates, only when the table is empty (edit or delete them in the dashboard)
INSERT INTO email_templates (name, subject, body)
SELECT * FROM (VALUES
  ('Intro: website ideas', 'Quick idea for {business_name}',
   E'Hi {first_name},\n\nI came across {website} and had a couple of ideas that could help {business_name} turn more visitors into enquiries, mainly around page speed, the mobile layout and a clearer path to getting in touch.\n\nWould you be open to a quick 15-minute call this week? I''m happy to share a few specific suggestions, no strings attached.\n\nIf this isn''t relevant, just let me know and I won''t follow up.\n\n{signature}'),
  ('Follow-up', 'Re: Quick idea for {business_name}',
   E'Hi {first_name},\n\nJust following up on my note from last week. Would a quick call be useful? You can pick any time that suits you here: https://cal.com/minhaljafar/15min\n\nIf now isn''t a good time, no worries at all.\n\n{signature}')
) AS starter(name, subject, body)
WHERE NOT EXISTS (SELECT 1 FROM email_templates);
