-- Cluster setup of the disposable test service.
--
-- The PostgreSQL entry point runs this file once, as the image superuser. It
-- creates the migration role and the first test database, so every check runs
-- under the production role model: the migration role owns the schema, holds
-- CREATEROLE and CREATEDB, and is not a superuser. A superuser would bypass
-- row level security, and FORCE row level security would then prove nothing.
--
-- CREATEDB lets the integration tests create a disposable database for each
-- test file. pg_signal_backend lets `DROP DATABASE ... WITH (FORCE)` close the
-- runtime role's pooled connections. Both belong to this throwaway service.
CREATE ROLE notesapp_migrate
  LOGIN PASSWORD 'notesapp_migrate_test'
  CREATEROLE CREATEDB NOSUPERUSER NOBYPASSRLS NOREPLICATION;

GRANT pg_signal_backend TO notesapp_migrate;

CREATE DATABASE notesapp_test OWNER notesapp_migrate;
