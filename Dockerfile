# syntax=docker/dockerfile:1
#
# Build from the repository root:   docker build -t theonionbox .
# Run (as before):                  docker run --network host -p 8080:8080 theonionbox
#
# Stage 1 builds the dashboard (Vite + React + Tailwind + shadcn/ui) - Node is NOT part of the final image.
FROM node:22-alpine AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN mkdir -p /src/theonionbox
RUN npm run build

# Stage 2: the Python application.
FROM python:3.12-slim

EXPOSE 8080

WORKDIR /app
COPY . /app
# Replace the committed build with the freshly built one.
RUN rm -rf /app/theonionbox/web
COPY --from=web /src/theonionbox/web /app/theonionbox/web

RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
 && pip install --no-cache-dir . \
 && mkdir -p /etc/theonionbox \
 && cp /app/Docker/theonionbox.cfg /etc/theonionbox/theonionbox.cfg

# The working directory must not hide the installed package (and its bundled 'web' build).
WORKDIR /
ENTRYPOINT ["theonionbox", "-c", "/etc/theonionbox/theonionbox.cfg"]
