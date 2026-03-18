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

# Cache bust: 2026-03-18-v5
COPY . .

# Create seed data directory (volume will be mounted at /app/data, shadowing it)
# So we copy seed data to /app/data_seed/ instead
# The init-volume.js script will copy from here on first run
RUN mkdir -p /app/data_seed && \
    cp data/clients.json /app/data_seed/ && \
    cp data/invoice-counter.json /app/data_seed/ && \
    cp data/invoiced-messages.json /app/data_seed/

EXPOSE 3000

# Health check — Railway uses this to determine if app is healthy
# Checks /api/status every 10 seconds, with 5 retries, 30 second timeout
# Extended start-period to 180s because WhatsApp initialization can take time
HEALTHCHECK --interval=10s --timeout=30s --start-period=180s --retries=5 \
  CMD curl -f http://localhost:3000/api/status || exit 1

RUN chmod +x start.sh
CMD ["./start.sh"]
