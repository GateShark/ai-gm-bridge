# ai-gm-relay. Build: docker build -t ai-gm-relay ./relay (see RUN.md)
FROM mcr.microsoft.com/playwright:v1.56.0-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY *.mjs ./
ENV AIGM_RELAY_DATA=/data
VOLUME /data
USER pwuser
CMD ["node", "index.mjs"]
