-- Separate databases and roles per service (local/dev).
CREATE USER identity WITH PASSWORD 'identity';
CREATE DATABASE identity OWNER identity;

CREATE USER organizations WITH PASSWORD 'organizations';
CREATE DATABASE organizations OWNER organizations;

CREATE USER marketplace WITH PASSWORD 'marketplace';
CREATE DATABASE marketplace OWNER marketplace;

CREATE USER booking WITH PASSWORD 'booking';
CREATE DATABASE booking OWNER booking;

CREATE USER clients WITH PASSWORD 'clients';
CREATE DATABASE clients OWNER clients;

CREATE USER commerce WITH PASSWORD 'commerce';
CREATE DATABASE commerce OWNER commerce;

CREATE USER communications WITH PASSWORD 'communications';
CREATE DATABASE communications OWNER communications;

CREATE USER reporting WITH PASSWORD 'reporting';
CREATE DATABASE reporting OWNER reporting;

-- Extensions that require superuser for service DBs.
\connect identity
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\connect booking
CREATE EXTENSION IF NOT EXISTS btree_gist;
