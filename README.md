# Azure Hermes Factory

A comprehensive Infrastructure-as-Code (IaC) solution for deploying **Hermes AI Agent** dedicated container orchestration on Microsoft Azure using Azure Container Apps.

## Overview

Azure Hermes Factory provides a complete, production-ready deployment architecture for Hermes AI Agents running in isolated Azure containers. It automates infrastructure provisioning, container management, and operational governance across development and production environments.

## Key Features

- 🏗️ **Infrastructure as Code (Bicep)** - Declarative Azure resource management
- 🔐 **Multi-Environment Support** - Separate dev and prod deployments (rg-hermes-dev, rg-hermes-prod)
- 🤖 **Hermes AI Agents** - Dedicated container runtime for Hermes agents (analyst, hermes, and custom agents)
- 📦 **Azure Container Apps** - Serverless container orchestration with built-in scaling
- 📊 **Logging & Monitoring** - Log Analytics integration for observability
- 🔄 **Container Registry** - Azure Container Registry (ACR) for image storage and versioning
- 🎯 **Rollback Support** - Scripts for deployment rollback and version management
- ✅ **Smoke Tests** - Automated health checks for dev and prod environments

## Repository Structure

```
.
├── agents/                  # Hermes agent container definitions
│   ├── hermes/             # Core Hermes agent
│   ├── analyst/            # Analyst agent
│   ├── hermes-ai/          # Generic Hermes AI container
│   ├── src/                # Agent source code and runtime logic
│   └── config/             # Agent configuration files (hermes.json)
├── infra/                   # Infrastructure as Code
│   ├── bicep/              # Azure Bicep templates
│   │   ├── main.bicep      # Main orchestration template
│   │   └── modules/        # Reusable Bicep modules
│   └── iam/                # Identity and Access Management
│       └── rbac.bicep      # Role-Based Access Control definitions
├── scripts/                 # Operational scripts
│   ├── revisions.sh        # Revision management
│   ├── rollback.sh         # Deployment rollback
│   └── build.sh            # Build automation
├── smoke-tests/            # Automated testing
│   ├── smoke-dev.sh        # Dev environment tests
│   └── smoke-prod.sh       # Prod environment tests
└── README.md               # This file

## Prerequisites

- Azure CLI (az)
- Bicep CLI
- Docker
- Node.js 22+
- Bash shell
- Azure subscription with appropriate permissions

## Quick Start

### 1. Configure Your Azure Environment

```bash
export AZURE_SUBSCRIPTION_ID="your-subscription-id"
export HERMES_LOCATION="eastus"
export HERMES_VERSION="2026.6.10"
```

### 2. Deploy Infrastructure (Dev)

```bash
az account set --subscription "${AZURE_SUBSCRIPTION_ID}"
az deployment sub create \
  --location "${HERMES_LOCATION}" \
  --template-file infra/bicep/main.bicep \
  --parameters rgDevName=rg-hermes-dev rgProdName=rg-hermes-prod
```

### 3. Build and Push Container Images

```bash
# Build Hermes agent image
docker build -t hermes:${HERMES_VERSION} agents/hermes/
docker tag hermes:${HERMES_VERSION} ${ACR_NAME}.azurecr.io/hermes:${HERMES_VERSION}
docker push ${ACR_NAME}.azurecr.io/hermes:${HERMES_VERSION}
```

### 4. Health Check

```bash
# Run smoke tests
./smoke-tests/smoke-dev.sh
./smoke-tests/smoke-prod.sh
```

## Configuration

### Environment Variables

Key environment variables for agent configuration:

- `HERMES_GATEWAY_PORT` - Agent gateway port (default: 19001)
- `HERMES_VERSION` - Hermes agent package version
- `HERMES_AI_IMAGE_REPOSITORY` - Container image repository name
- `AGENT_CONFIG` - Path to agent configuration file (hermes.json)

### Agent Configuration

Each agent has a dedicated configuration file at `agents/<agent-name>/config/hermes.json`. Customize this file per your deployment requirements.

## Deployment

### Dev Environment (rg-hermes-dev)

Deploy to development resource group for testing and validation:

```bash
./scripts/build.sh dev ${HERMES_VERSION}
```

### Prod Environment (rg-hermes-prod)

Deploy to production resource group for live workloads:

```bash
./scripts/build.sh prod ${HERMES_VERSION}
```

## Rollback Procedure

To rollback a deployment to a previous version:

```bash
./scripts/rollback.sh <agent-name> <environment> <image-tag>
# Example:
./scripts/rollback.sh hermes dev hermes-abc1234
```

## Monitoring & Logs

Logs are centralized in Log Analytics workspace: `hermes-logs`

Query recent logs:
```bash
az monitor log-analytics query \
  --workspace <workspace-id> \
  --analytics-query "ContainerAppConsoleLogs_CL | tail 50"
```

## Container Apps Scaling

Generic Hermes AI Container Apps can be provisioned dynamically via the `hermesAIContainerAppCount` parameter:

```bicep
hermesAIContainerAppCount: 3  # Creates hermes-ai-1, hermes-ai-2, hermes-ai-3
```

## Inter-Agent Communication (A2A Protocol)

Hermes agents communicate with each other using the **[Agent2Agent (A2A) Protocol](https://a2a-protocol.org/v0.3.0/specification/)** (v0.3.0) — JSON-RPC 2.0 over HTTP. Every agent is both an A2A **server** (it can be messaged) and an A2A **client** (it can message peers).

### How discovery works on Azure Container Apps

Agents in the same Container Apps environment reach each other over the environment's internal DNS. At deploy time, `infra/bicep/modules/container-apps.bicep` injects each agent's peers as the `A2A_PEERS` env var:

```
A2A_PEERS=analyst=https://analyst-dev.<env-domain>,hermes-ai-1=https://hermes-ai-1-dev.<env-domain>
```

No service registry is required — the peer list is derived from the agents deployed in the environment.

### Endpoints exposed by each agent

| Endpoint | Method | Purpose |
|---|---|---|
| `/.well-known/agent-card.json` | GET | A2A discovery — the agent's capabilities/skills/endpoint |
| `/a2a` | POST | A2A JSON-RPC endpoint: `message/send`, `tasks/get`, `tasks/cancel` |
| `/a2a/peers` | GET | Introspection — list known peers |
| `/a2a/send` | POST | Convenience — ask this agent to message a peer: `{"to":"analyst","text":"..."}` |
| `/health` | GET | Liveness/readiness |

### Example: one agent messaging another

```bash
# Ask hermes to send an A2A message to analyst
curl -X POST https://hermes-dev.<env-domain>/a2a/send \
  -H "content-type: application/json" \
  -d '{"to":"analyst","text":"summarize the latest deployment"}'
```

The receiving agent creates an A2A **Task**, processes the message via its local runtime, and returns the completed task (with `history` and `artifacts`).

### Authentication

Set a shared bearer token to require auth on all A2A calls (recommended for prod):

```bash
az deployment sub create ... --parameters a2aAuthToken="$(openssl rand -hex 32)"
```

The token is stored as a Container Apps **secret** and injected as `A2A_AUTH_TOKEN`. When set, inbound `/a2a` and `/a2a/send` requests require `Authorization: Bearer <token>`, and outbound calls include it automatically. Leave empty to disable auth (dev only).

### Plugging in the runtime

By default the A2A handler returns a deterministic processed reply. To route incoming messages to the real agent runtime, point `A2A_EXECUTOR_URL` at a local HTTP endpoint that accepts `{"input":"..."}` and returns `{"output":"..."}` (e.g. a thin adapter in front of the openclaw gateway). Set `AGENT_RUNTIME_ENABLED=false` to run the A2A layer without spawning the runtime (used by local/CI tests).

## Security Considerations

- All resources use managed identities for authentication
- Container images are stored in private Azure Container Registry
- RBAC policies defined in `infra/iam/rbac.bicep`
- Network access controlled via Container Apps network settings
- Secrets managed through Azure Key Vault integration

## Troubleshooting

### Agent fails to start
1. Check container logs: `az containerapp logs show --name <agent-name> --resource-group <rg>`
2. Verify configuration file: `agents/<agent-name>/config/hermes.json`
3. Validate Hermes runtime: `openclaw --version`

### Deployment rollback issues
Run: `./scripts/rollback.sh <agent> <env> <tag>`

### Resource group issues
Verify resource group exists: `az group show --name rg-hermes-dev`

## Contributing

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make changes and commit: `git commit -am "description"`
3. Push to feature branch: `git push origin feature/your-feature`
4. Submit pull request for review

## Support

For issues or questions, please refer to the Azure documentation or contact the infrastructure team.

## License

[Specify your license here]
