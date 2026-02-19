FROM node:20-slim

# Install git (needed for repo cloning)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all dependencies (including devDependencies for tsc build)
COPY package.json package-lock.json* ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Remove devDependencies after build
RUN npm prune --omit=dev

EXPOSE 3001

CMD ["node", "dist/index.js"]
