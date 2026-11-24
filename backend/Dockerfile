FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm install

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .
RUN rm -f *.tsbuildinfo && npm run build

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && (npx prisma db seed || true) && node dist/main.js"]
