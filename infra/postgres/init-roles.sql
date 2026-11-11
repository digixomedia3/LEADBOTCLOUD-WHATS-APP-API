-- DEV ONLY passwords. Production uses generated secrets (see docs/RUNBOOK.md).
-- owner: runs migrations, owns tables (RLS does not apply to owners, so never used by the app)
CREATE ROLE owner LOGIN PASSWORD 'owner_dev_password' NOSUPERUSER NOBYPASSRLS;
-- app: used by DATABASE_URL. Not owner, not superuser, RLS enforced.
CREATE ROLE app LOGIN PASSWORD 'app_dev_password' NOSUPERUSER NOBYPASSRLS NOINHERIT;
-- worker: used by DATABASE_URL_WORKER. Bypasses RLS; never reachable from browser code.
CREATE ROLE worker LOGIN PASSWORD 'worker_dev_password' NOSUPERUSER BYPASSRLS NOINHERIT;
GRANT ALL ON DATABASE leadbotcloud TO owner;
GRANT CONNECT ON DATABASE leadbotcloud TO app, worker;
ALTER SCHEMA public OWNER TO owner;
GRANT USAGE ON SCHEMA public TO app, worker;
ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app, worker;
ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app, worker;
