-- RescuePlate schema.
-- Integrity is enforced in the database as well as in application code:
-- foreign keys on every link, CHECK constraints on every quantity and status,
-- and partial unique indexes that make certain race outcomes impossible.

CREATE TABLE app_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
INSERT INTO app_settings (key, value) VALUES ('clock_offset', '{"seconds": 0}');

-- Application clock. All business rules read time through this function so the
-- demo console can fast-forward time. It uses clock_timestamp() (not now()),
-- so a transaction that waited on a row lock still sees the real current time.
CREATE FUNCTION app_now() RETURNS timestamptz
LANGUAGE sql VOLATILE AS $$
  SELECT clock_timestamp() + make_interval(secs => COALESCE(
    (SELECT (value->>'seconds')::double precision FROM app_settings WHERE key = 'clock_offset'), 0))
$$;

CREATE TABLE organizations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                 text NOT NULL CHECK (type IN ('donor', 'ngo')),
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  address              text NOT NULL CHECK (char_length(address) BETWEEN 5 AND 300),
  lat                  double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng                  double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  daily_capacity_meals integer CHECK (daily_capacity_meals BETWEEN 1 AND 100000),
  status               text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'SUSPENDED')),
  join_code            text NOT NULL UNIQUE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- NGOs must declare a capacity; donors must not.
  CONSTRAINT capacity_matches_type CHECK ((type = 'ngo') = (daily_capacity_meals IS NOT NULL))
);
CREATE UNIQUE INDEX organizations_type_name_key ON organizations (type, lower(name));

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  email         text NOT NULL CHECK (char_length(email) <= 254),
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('donor', 'ngo', 'volunteer', 'admin')),
  org_id        uuid REFERENCES organizations (id) ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Donor and NGO staff always belong to an organization; volunteers and admins never do.
  CONSTRAINT org_matches_role CHECK ((role IN ('donor', 'ngo')) = (org_id IS NOT NULL))
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_org_idx ON users (org_id);

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,          -- SHA-256 of the cookie value; the raw token is never stored
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE listings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_org_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  created_by      uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  title           text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description     text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  food_type       text NOT NULL CHECK (food_type IN ('cooked_meal', 'bakery', 'produce', 'packaged', 'dairy', 'beverages')),
  is_veg          boolean NOT NULL,
  total_meals     integer NOT NULL CHECK (total_meals BETWEEN 1 AND 5000),
  remaining_meals integer NOT NULL,
  prepared_at     timestamptz NOT NULL,
  safe_until      timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'POSTED'
                  CHECK (status IN ('POSTED', 'PARTIALLY_CLAIMED', 'FULLY_CLAIMED', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
  version         integer NOT NULL DEFAULT 1,   -- optimistic-lock counter, bumped on every change
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Last line of defence against overselling: the row can never go negative.
  CONSTRAINT remaining_within_total CHECK (remaining_meals >= 0 AND remaining_meals <= total_meals),
  CONSTRAINT safe_after_prepared CHECK (safe_until > prepared_at)
);
CREATE INDEX listings_status_safe_idx ON listings (status, safe_until);
CREATE INDEX listings_donor_idx ON listings (donor_org_id, created_at DESC);

CREATE TABLE claims (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id               uuid NOT NULL REFERENCES listings (id) ON DELETE RESTRICT,
  ngo_org_id               uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  claimed_by               uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  meals                    integer NOT NULL CHECK (meals > 0),
  status                   text NOT NULL DEFAULT 'CLAIMED'
                           CHECK (status IN ('CLAIMED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP', 'DELIVERED', 'RELEASED', 'CANCELLED', 'EXPIRED')),
  handover_code            text NOT NULL,
  awaiting_volunteer_since timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  closed_at                timestamptz
);
-- An NGO can hold at most one open claim on a listing. Even if application
-- checks were bypassed, a second concurrent insert would fail here.
CREATE UNIQUE INDEX claims_one_open_per_ngo ON claims (listing_id, ngo_org_id)
  WHERE status IN ('CLAIMED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP');
CREATE INDEX claims_listing_idx ON claims (listing_id);
CREATE INDEX claims_ngo_idx ON claims (ngo_org_id, created_at DESC);
CREATE INDEX claims_status_idx ON claims (status);

CREATE TABLE pickups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id     uuid NOT NULL REFERENCES claims (id) ON DELETE RESTRICT,
  volunteer_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  assigned_by  uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status       text NOT NULL DEFAULT 'ASSIGNED'
               CHECK (status IN ('ASSIGNED', 'PICKED_UP', 'DELIVERED', 'ABANDONED', 'VOIDED')),
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  picked_up_at timestamptz,
  delivered_at timestamptz,
  closed_at    timestamptz
);
-- A claim can have only one live pickup: two volunteers cannot both win it.
CREATE UNIQUE INDEX pickups_one_live_per_claim ON pickups (claim_id)
  WHERE status IN ('ASSIGNED', 'PICKED_UP');
CREATE INDEX pickups_volunteer_idx ON pickups (volunteer_id, status);

CREATE TABLE idempotency_keys (
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scope           text NOT NULL,
  key             text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  request_hash    text NOT NULL,
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope, key)
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users (id) ON DELETE SET NULL,   -- NULL = system (background job)
  actor_label text NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  meta        jsonb,
  request_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log (entity_type, entity_id, id DESC);
CREATE INDEX audit_created_idx ON audit_log (created_at DESC);
