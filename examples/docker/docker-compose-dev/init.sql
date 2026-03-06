-- =============================================================================
-- Database Initialization Script
-- =============================================================================
-- This runs automatically on first Postgres container start (and only then).
-- Place in docker-entrypoint-initdb.d/ for auto-execution.
-- To re-run: `docker compose down -v && docker compose up`
-- =============================================================================

-- Enable common extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Example table — replace with your own schema
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed data for development
INSERT INTO users (email, name) VALUES
    ('alice@example.com', 'Alice Johnson'),
    ('bob@example.com', 'Bob Smith')
ON CONFLICT (email) DO NOTHING;
