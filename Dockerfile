# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Трасування standalone тягне лише те, що імпортує код: SQL-файли міграцій і
# скрипт створення користувача треба покласти явно. Перші читає instrumentation.ts
# на старті, другий запускають руками з консолі Railway, щоб завести власника.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts

# Next вбудовує bcryptjs у серверний бандл, тож як пакет у standalone його
# немає — а scripts/create-user.mjs запускається окремим процесом і резолвить
# його звичайним способом. `pg` там уже лежить: його Next лишає зовнішнім.
COPY --from=deps /app/node_modules/bcryptjs ./node_modules/bcryptjs

USER nextjs
EXPOSE 3000
# Railway підставляє власний PORT — тутешній лишається запасним для
# локального `docker run` без змінних.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
