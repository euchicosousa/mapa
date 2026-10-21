-- Local fictitious workspaces only. Auth users are created using the real
-- Auth Admin API by npm run seed:local, never by inserting into auth internals.
insert into public.workspaces(id, name) values
  ('11111111-1111-4111-8111-111111111111', 'Equipe X'),
  ('22222222-2222-4222-8222-222222222222', 'Equipe Y')
on conflict(id) do update set name = excluded.name;
