-- Applied to the existing MeetIntheMiddle Supabase project.
-- Prior snapshots remain NULL, so daily estimated P&L stays unavailable until
-- there is a complete previous-day position baseline.
alter table portfolio.snapshots
  add column if not exists position_signature text;
