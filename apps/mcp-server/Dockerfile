FROM mcr.microsoft.com/playwright:v1.38.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install
RUN npm install @playwright/test

COPY . .

RUN npx playwright install chromium

EXPOSE 4000

CMD ["npm", "start"]