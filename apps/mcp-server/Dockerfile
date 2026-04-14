FROM mcr.microsoft.com/playwright:v1.38.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install

# Install test package only
RUN npm install @playwright/test

COPY . .

EXPOSE 4000

CMD ["npm", "start"]