FROM oven/bun:1.4.2-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    DATA_DIR=/app/data

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY --chown=10001:10001 src ./src
COPY --chown=10001:10001 public ./public
COPY --chown=10001:10001 drizzle ./drizzle
RUN mkdir -p /app/data && chown -R 10001:10001 /app/data

USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD bun -e 'const response = await fetch("http://127.0.0.1:8000/readyz"); if (!response.ok) process.exit(1)'

CMD ["bun", "run", "start"]
