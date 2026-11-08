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
 && mkdir -p /etc/theonionbox /data \
 && cp /app/Docker/theonionbox.cfg /etc/theonionbox/theonionbox.cfg \
 && cp /app/Docker/entrypoint.sh /usr/local/bin/tob-entrypoint \
 && chmod +x /usr/local/bin/tob-entrypoint \
 && useradd --system --uid 10001 --home-dir /data --shell /usr/sbin/nologin tob \
 && chown -R tob /data \
 && rm -rf /app

# Everything that has to survive a restart / redeploy lives here: cc.cfg (your nodes & their credentials).
VOLUME /data

# Never run as root; the working directory must not hide the installed package (and its bundled 'web' build).
USER tob
WORKDIR /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/__health', timeout=4)" || exit 1

ENTRYPOINT ["tob-entrypoint"]
