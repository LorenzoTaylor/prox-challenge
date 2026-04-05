# Stage 1: Build frontend
FROM node:24-slim AS frontend-builder
WORKDIR /app
COPY frontend/package.json frontend/
RUN cd frontend && npm install
COPY frontend/ frontend/
RUN cd frontend && npm run build

# Stage 2: Build backend
FROM rust:slim AS backend-builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY backend/ backend/
RUN cargo build --release --manifest-path backend/Cargo.toml

# Stage 3: Runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend-builder /app/backend/target/release/server ./
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist/
COPY scripts/ ./scripts/
CMD ["./server"]
