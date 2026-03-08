FROM node:20-slim AS deps
WORKDIR /workspace/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /workspace
COPY --from=deps /workspace/apps/web/node_modules /workspace/apps/web/node_modules
COPY apps/web /workspace/apps/web
COPY data /workspace/data
WORKDIR /workspace/apps/web
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /workspace/apps/web
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080
COPY --from=builder /workspace/apps/web /workspace/apps/web
EXPOSE 8080
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "8080"]
