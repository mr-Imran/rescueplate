-- Optimistic-lock counter for organizations, bumped on every change to the row
-- (the same scheme listings use). Two staff members saving the Organization
-- page at the same time used to be "last write wins"; with a version the second
-- save is detected and merged instead of silently overwriting the first.
ALTER TABLE organizations ADD COLUMN version integer NOT NULL DEFAULT 1;
