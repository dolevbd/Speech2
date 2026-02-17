FROM node:20-slim

# Install Claude Code CLI globally so the Agent SDK can spawn it
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

EXPOSE 3001

CMD ["node", "dist/index.js"]
