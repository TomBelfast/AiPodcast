#!/bin/bash
set -e

echo ">>> Starting PostgreSQL..."
service postgresql start

echo ">>> Waiting for PostgreSQL to start..."
until pg_isready -h localhost -p 5432; do
  sleep 1
done

echo ">>> Configuring PostgreSQL user and database..."
su - postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
su - postgres -c "psql -c \"CREATE DATABASE openbrief;\"" || true

echo ">>> Setting local POSTGRES_URL..."
cd /app/client
sed -i 's|^POSTGRES_URL=.*|POSTGRES_URL="postgres://postgres:postgres@localhost:5432/openbrief"|g' .env
export POSTGRES_URL="postgres://postgres:postgres@localhost:5432/openbrief"

echo ">>> Applying database schema migrations via Drizzle Kit..."
pnpm --filter @acme/db push

echo ">>> Starting TTS server (port 8765)..."
python3 /app/tts_server.py &
TTS_PID=$!
echo "    TTS server PID: $TTS_PID"

echo ">>> Starting Next.js web application (port 3001)..."
export PORT=3001
export HOSTNAME=0.0.0.0
export TTS_SERVER_URL=http://localhost:8765

exec pnpm --filter @acme/nextjs dev
