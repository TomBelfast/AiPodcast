#!/bin/bash
set -e

echo ">>> Starting PostgreSQL..."
service postgresql start

echo ">>> Waiting for PostgreSQL..."
until pg_isready -h localhost -p 5432; do sleep 1; done

echo ">>> Configuring PostgreSQL..."
su - postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\"" 2>/dev/null || true
su - postgres -c "psql -c \"CREATE DATABASE openbrief;\"" 2>/dev/null || true

echo ">>> Setting POSTGRES_URL in .env..."
cd /app/client
sed -i 's|^POSTGRES_URL=.*|POSTGRES_URL="postgres://postgres:postgres@localhost:5432/openbrief"|g' .env
export POSTGRES_URL="postgres://postgres:postgres@localhost:5432/openbrief"

echo ">>> Applying DB migrations..."
pnpm --filter @acme/db push

echo ">>> Starting TTS server (port 8765)..."
TTS_PORT=8765 python3 /app/tts_server.py &
echo "    TTS PID: $!"

echo ">>> Starting Next.js (port 3001)..."
export PORT=3001
export HOSTNAME=0.0.0.0
export TTS_SERVER_URL=http://localhost:8765

exec pnpm --filter @acme/nextjs dev
