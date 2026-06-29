FROM node:26-slim

WORKDIR /app

# Install Hermes Agent
ARG HERMES_VERSION=2026.6.10
RUN npm install -g "openclaw@${HERMES_VERSION}" \
  && command -v openclaw

# Copy agent source and config
COPY src/ ./src/
COPY config/ ./config/

# Default agent entrypoint
ENV AGENT_NAME=hermes-ai-dedicated
ENV AGENT_CONFIG=/app/config/hermes.json
ENV PORT=8080
ENV HERMES_GATEWAY_PORT=19001

EXPOSE 8080

ENTRYPOINT ["node", "src/agent.js"]
