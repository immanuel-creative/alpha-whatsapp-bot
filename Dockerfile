FROM node:20-slim

# Install Google Chrome (the proper way for Railway / Linux amd64)
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    --no-install-recommends \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub \
       | gpg --dearmor > /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] \
       http://dl.google.com/linux/chrome/deb/ stable main" \
       > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    WWEBJS_AUTH_PATH=/app/data \
    NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Cache bust: 2026-03-18-v10
COPY . .

# Create seed data directory (volume will be mounted at /app/data, shadowing it)
# So we copy seed data to /app/data_seed/ instead
# The init-volume.js script will copy from here on first run
# Use conditional copies to handle missing files gracefully
RUN mkdir -p /app/data_seed && \
    (cp data/clients.json /app/data_seed/ 2>/dev/null || echo "No clients.json found") && \
    (cp data/invoice-counter.json /app/data_seed/ 2>/dev/null || echo "No invoice-counter.json found") && \
    (cp data/invoiced-messages.json /app/data_seed/ 2>/dev/null || echo "No invoiced-messages.json found")

EXPOSE 3000

# HEALTHCHECK REMOVED - Railway will check TCP connectivity on port 3000 instead
# This is more reliable during WhatsApp initialization which can timeout HTTP requests

# CMD is overridden by railway.toml startCommand: node index.js
# But we'll set a sensible default just in case
CMD ["node", "index.js"]
