# One container: the API also serves the built app.
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-slim
RUN apt-get update -y && apt-get install -y openssl default-mysql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package*.json ./
COPY backend/prisma ./prisma
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=web /app/frontend/dist /app/frontend/dist
ENV NODE_ENV=production PORT=3011
EXPOSE 3011
CMD ["sh", "-c", "npx prisma migrate deploy && node api/server.js"]
