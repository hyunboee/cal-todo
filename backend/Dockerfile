# 빌드(저장소 루트에서): docker build -f backend/Dockerfile -t cal-todo .
# 배포 순서(OP-11): docker run --rm --env-file <운영 env> cal-todo node scripts/migrate.js → 같은 이미지로 서버 실행
FROM node:26-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:26-slim
ENV NODE_ENV=production
RUN npm install -g pm2@6
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/migrations ./migrations
# FRONTEND_DIST 기본값(../frontend/dist)과 같은 위치
COPY --from=frontend /app/frontend/dist /app/frontend/dist
USER node
EXPOSE 3000
# PRD 7.6: PM2 클러스터 2프로세스. 시크릿은 호스팅에서 환경변수로 주입(OP-02)
CMD ["pm2-runtime", "src/server.js", "-i", "2"]
