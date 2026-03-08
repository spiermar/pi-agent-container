FROM node:20.11.0-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20.11.0-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=0 /app/dist ./dist

RUN mkdir -p /app/workspace

USER node

ENV NODE_ENV=production
ENV WEBSOCKET_PORT=8080

EXPOSE 8080

CMD ["node", "dist/agent.js"]