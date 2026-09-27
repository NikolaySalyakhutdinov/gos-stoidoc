FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 4000
CMD ["node", "src/index.js"]
