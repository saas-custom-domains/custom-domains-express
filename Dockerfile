FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_URL=file:/app/data/app.db \
    NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json prisma.config.js ./
COPY prisma ./prisma
# Runs `prisma generate` (postinstall).
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/data && chown node /app/data
USER node
EXPOSE 3000
# Apply migrations and seed the two example companies, then start.
CMD ["sh", "-c", "npm run db:setup && exec node src/server.js"]
