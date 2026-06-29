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
