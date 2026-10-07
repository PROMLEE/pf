-- The shared Supabase project uses server-side Postgres for PortRhythm.
-- None of these public tables needs direct anon/authenticated Data API access.
-- Keep the owner/server connection working while denying client-role access.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'FriendRequest', 'Friendship', 'Participant', 'PlaceKnowledge',
    'PlaceReview', 'RecommendationTelemetry', 'RecommendedPlace',
    'Room', 'RoomMatchFeedback', 'StationKnowledge',
    'StationPlaceRecommendation', 'User', 'Vote'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'revoke all privileges on table public.%I from anon, authenticated, public',
      table_name
    );
  end loop;
end $$;

-- Prevent tables created later by the same database owner from receiving
-- automatic client-role grants before their access model is reviewed.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
