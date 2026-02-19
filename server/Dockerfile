FROM node:20-slim

# Install git (needed for repo cloning)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy source and build
COPY . .
RUN npm run build

EXPOSE 3001

CMD ["node", "dist/index.js"]
