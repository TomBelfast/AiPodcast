# CUDA-enabled base so onnxruntime-gpu and supertonic can use the GPU.
# Uses node:22-slim as final stage to keep the image lean while still
# having CUDA driver libraries available at runtime via --gpus all.
FROM node:22-slim

# System deps: PostgreSQL + Python + CUDA runtime libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    wget \
    gnupg \
    postgresql \
    postgresql-contrib \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Add NVIDIA CUDA apt repo and install runtime libs needed by onnxruntime-gpu
RUN wget -qO /tmp/cuda-keyring.deb \
    https://developer.download.nvidia.com/compute/cuda/repos/debian12/x86_64/cuda-keyring_1.1-1_all.deb \
    && dpkg -i /tmp/cuda-keyring.deb && rm /tmp/cuda-keyring.deb \
    && apt-get update && apt-get install -y --no-install-recommends \
    cuda-cudart-12-8 \
    libcublas-12-8 \
    libcufft-12-8 \
    libcurand-12-8 \
    libcusparse-12-8 \
    libcudnn9-cuda-12 \
    && ldconfig \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@11.0.9

WORKDIR /app

# Copy the monorepo source files
COPY . .

# Ensure entrypoint script is executable
RUN chmod +x /app/entrypoint.sh

# Install Python TTS dependencies.
# onnxruntime-gpu uses CUDAExecutionProvider when --gpus all is passed
# at docker run time (driver libs are injected by NVIDIA Container Toolkit).
RUN pip3 install --break-system-packages \
    "supertonic>=1.3.1" \
    "onnxruntime-gpu>=1.19"

# Go to client workspace
WORKDIR /app/client

# Copy .env.example as .env only if .env does not already exist.
# This preserves keys set via -e flags or a mounted .env volume.
RUN if [ ! -f .env ]; then cp .env.example .env; fi

# Install Node dependencies
RUN pnpm install

# Persist podcasts across container restarts when using a named volume
VOLUME ["/app/podcasts"]

# Next.js | TTS server
EXPOSE 3001
EXPOSE 8765

ENTRYPOINT ["/app/entrypoint.sh"]
