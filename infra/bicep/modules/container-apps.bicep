// modules/container-apps.bicep - Creates Container Apps for each agent
// Each app is wired for Agent2Agent (A2A) communication: it receives the list
// of its peers (other agents in the same environment) via the A2A_PEERS env var,
// resolved through Azure Container Apps' in-environment DNS.

param agentNames array
@minValue(0)
@description('Number of generic Hermes Container Apps to create in this environment.')
param hermesAIContainerAppCount int = 0
param environmentSuffix string
param acaEnvName string
param location string = resourceGroup().location
param tags object = {}

@description('Optional shared bearer token used to authenticate A2A requests between agents. Leave empty to disable A2A auth (dev only).')
@secure()
param a2aAuthToken string = ''

// Placeholder image — will be replaced by CI/CD deployments
var defaultImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
var hermesAIContainerAppNames = [for index in range(0, hermesAIContainerAppCount): 'hermes-ai-${index + 1}']
var containerAppNames = concat(agentNames, hermesAIContainerAppNames)

// Full Container App names (with env suffix) used for in-environment DNS.
var appFullNames = [for name in containerAppNames: '${name}-${environmentSuffix}']

resource acaEnv 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: acaEnvName
}

// Environment DNS suffix, e.g. <unique>.<region>.azurecontainerapps.io
var envDomain = acaEnv.properties.defaultDomain
var useA2AAuth = !empty(a2aAuthToken)

resource containerApps 'Microsoft.App/containerApps@2024-03-01' = [for (agentName, i) in containerAppNames: {
  name: '${agentName}-${environmentSuffix}'
  location: location
  properties: {
    managedEnvironmentId: acaEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      secrets: useA2AAuth ? [
        {
          name: 'a2a-auth-token'
          value: a2aAuthToken
        }
      ] : []
    }
    template: {
      containers: [
        {
          name: agentName
          image: defaultImage
          env: concat([
            {
              name: 'PORT'
              value: '8080'
            }
            {
              name: 'AGENT_NAME'
              value: agentName
            }
            // This agent's own A2A base URL (its Agent Card lives at <url>/.well-known/agent-card.json)
            {
              name: 'A2A_SELF_URL'
              value: 'https://${agentName}-${environmentSuffix}.${envDomain}'
            }
            // Peer registry: every OTHER agent in this environment, reachable over
            // the in-environment HTTPS FQDN. Format: "name=url,name=url".
            {
              name: 'A2A_PEERS'
              value: join(map(filter(appFullNames, name => name != '${agentName}-${environmentSuffix}'), name => '${name}=https://${name}.${envDomain}'), ',')
            }
          ], useA2AAuth ? [
            {
              name: 'A2A_AUTH_TOKEN'
              secretRef: 'a2a-auth-token'
            }
          ] : [])
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
  tags: tags
}]

output fqdns array = [for i in range(0, length(containerAppNames)): {
  name: containerAppNames[i]
  suffix: environmentSuffix
  fqdn: containerApps[i].properties.configuration.ingress.fqdn
}]
