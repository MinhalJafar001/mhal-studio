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
