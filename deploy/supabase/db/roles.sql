-- Passwords of the Supabase service roles (runs once, on the first start of an empty data volume; as in
-- the official self-hosted stack). POSTGRES_PASSWORD comes from the environment of the db container.
\set pgpass `echo "$POSTGRES_PASSWORD"`

alter user authenticator with password :'pgpass';
alter user pgbouncer with password :'pgpass';
alter user supabase_auth_admin with password :'pgpass';
alter user supabase_storage_admin with password :'pgpass';
