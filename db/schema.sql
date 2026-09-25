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
