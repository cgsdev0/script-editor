FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY server.mjs .
COPY --from=build /app/dist ./dist

ENV PORT=1234
EXPOSE 1234
VOLUME /app/yjs-data

CMD ["node", "server.mjs"]
