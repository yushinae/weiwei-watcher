FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

EXPOSE 8787

CMD ["sh", "-c", "npm run migrate && npm run dev"]

