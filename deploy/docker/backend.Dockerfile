FROM node:20-alpine

WORKDIR /app

RUN mkdir -p /data/uploads

RUN apk add --no-cache python3 make g++

COPY backend/package.json backend/package-lock.json* ./
RUN npm install

COPY backend/ .
RUN npm run build && cp -r src/db/migrations dist/db/migrations

# Rebuild better-sqlite3 from source for the target platform
RUN cd node_modules/better-sqlite3 && npx --yes node-gyp rebuild 2>&1

RUN npm prune --omit=dev

EXPOSE 3000

ENV NODE_ENV=production
ENV DB_PATH=/data/deadchat.db
ENV UPLOAD_DIR=/data/uploads

CMD ["node", "dist/index.js"]
