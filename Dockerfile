FROM node:22-slim

# Install system dependencies: PostgreSQL + Python for TTS server
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    postgresql \
    postgresql-contrib \
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
    build-essential \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@11.0.9

WORKDIR /app

# Copy the monorepo source files
COPY . .

# Ensure entrypoint script is executable
RUN chmod +x /app/entrypoint.sh

# Install Python TTS dependencies (supertonic)
RUN pip3 install --break-system-packages supertonic>=1.3.1

# Go to client workspace
WORKDIR /app/client

# Configure environment defaults
RUN cp .env.example .env

# Install Node dependencies for the workspace
RUN pnpm install

# Expose Next.js port and TTS server port
EXPOSE 3001
EXPOSE 8765

# Execute PostgreSQL initialization, Drizzle migrations, and start all services
ENTRYPOINT ["/app/entrypoint.sh"]
