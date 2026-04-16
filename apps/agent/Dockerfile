FROM node:18-alpine

WORKDIR /app
RUN apk add --no-cache git github-cli \
 && git config --global --add safe.directory /workspace

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001

CMD ["node", "/app/index.js"]
