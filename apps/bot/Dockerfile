FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @football/bot build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY apps/bot/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/apps/bot/dist ./dist
USER node
CMD ["node", "dist/bot.js"]
