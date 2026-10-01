# 빌드: docker build -t cal-todo-api backend   (API 전용. 프론트엔드는 별도 정적 호스팅에 배포)
# 배포 순서(OP-11): docker run --rm --env-file <운영 env> cal-todo-api node scripts/migrate.js → 같은 이미지로 서버 실행
FROM node:26-slim
ENV NODE_ENV=production
RUN npm install -g pm2@6
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
COPY swagger.yaml ./
USER node
EXPOSE 3000
# PRD 7.6: PM2 클러스터 2프로세스. 시크릿은 호스팅에서 환경변수로 주입(OP-02)
CMD ["pm2-runtime", "src/server.js", "-i", "2"]
