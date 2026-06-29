// main.bicep - Main orchestration for all Hermes infrastructure
// Deploys: ACR, Container Apps environments, Container Apps, Log Analytics
// Does NOT deploy IAM/RBAC - see infra/iam/ for that

targetScope = 'subscription'

@description('Azure region for all resources')
param location string = 'eastus'

@description('Resource group name for dev environment')
param rgDevName string = 'rg-hermes-dev'

@description('Resource group name for prod environment')
param rgProdName string = 'rg-hermes-prod'

@description('ACR name (must be globally unique)')
param acrName string = 'hermesagentdev'

@description('ACR SKU')
param acrSku string = 'Basic'

@description('Container Apps environment name for dev')
param acaEnvDevName string = 'hermes-env-dev'

@description('Container Apps environment name for prod')
param acaEnvProdName string = 'hermes-env-prod'

@description('List of agent names to create Container Apps for')
param agentNames array = [
  'hermes'
  'analyst'
]

@minValue(0)
@description('Number of generic Hermes AI Container Apps to create per environment. Apps are named hermes-ai-1-<env>, hermes-ai-2-<env>, and so on.')
param hermesAIContainerAppCount int = 0

@description('Log Analytics workspace name')
param logAnalyticsName string = 'hermes-logs'

@description('Optional shared bearer token to authenticate Agent2Agent (A2A) requests between agents. Leave empty to disable A2A auth (dev only). Pass via a secure pipeline variable in production.')
@secure()
param a2aAuthToken string = ''

// ──────────────────────────────────────────────
// Resource Groups
// ──────────────────────────────────────────────
resource rgDev 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: rgDevName
  location: location
}

resource rgProd 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: rgProdName
  location: location
}

// ──────────────────────────────────────────────
// ACR (in dev RG)
// ──────────────────────────────────────────────
module acr './modules/acr.bicep' = {
  name: 'acr'
  scope: rgDev
  params: {
    acrName: acrName
    acrSku: acrSku
    location: location
  }
}

// ──────────────────────────────────────────────
// Log Analytics (in dev RG, shared)
// ──────────────────────────────────────────────
module logAnalytics './modules/log-analytics.bicep' = {
  name: 'logAnalytics'
  scope: rgDev
  params: {
    workspaceName: logAnalyticsName
    location: location
  }
}

// ──────────────────────────────────────────────
// Container Apps Environment - Dev
// ──────────────────────────────────────────────
module acaEnvDev './modules/aca-environment.bicep' = {
  name: 'acaEnvDev'
  scope: rgDev
  params: {
    envName: acaEnvDevName
    location: location
    logAnalyticsCustomerId: logAnalytics.outputs.workspaceCustomerId
    logAnalyticsSharedKey: logAnalytics.outputs.workspaceSharedKey
  }
}

// ──────────────────────────────────────────────
// Container Apps Environment - Prod
// ──────────────────────────────────────────────
module acaEnvProd './modules/aca-environment.bicep' = {
  name: 'acaEnvProd'
  scope: rgProd
  params: {
    envName: acaEnvProdName
    location: location
    logAnalyticsCustomerId: logAnalytics.outputs.workspaceCustomerId
    logAnalyticsSharedKey: logAnalytics.outputs.workspaceSharedKey
  }
}

// ──────────────────────────────────────────────
// Container Apps - Dev
// ──────────────────────────────────────────────
module containerAppsDev './modules/container-apps.bicep' = {
  name: 'containerAppsDev'
  scope: rgDev
  params: {
    agentNames: agentNames
    hermesAIContainerAppCount: hermesAIContainerAppCount
    environmentSuffix: 'dev'
    acaEnvName: acaEnvDevName
    location: location
    a2aAuthToken: a2aAuthToken
  }
  dependsOn: [
    acaEnvDev
  ]
}

// ──────────────────────────────────────────────
// Container Apps - Prod
// ──────────────────────────────────────────────
module containerAppsProd './modules/container-apps.bicep' = {
  name: 'containerAppsProd'
  scope: rgProd
  params: {
    agentNames: agentNames
    hermesAIContainerAppCount: hermesAIContainerAppCount
    environmentSuffix: 'prod'
    acaEnvName: acaEnvProdName
    location: location
    a2aAuthToken: a2aAuthToken
  }
  dependsOn: [
    acaEnvProd
  ]
}

// ──────────────────────────────────────────────
// Outputs
// ──────────────────────────────────────────────
output acrLoginServer string = acr.outputs.loginServer
output acrId string = acr.outputs.acrId

output devResourceGroup string = rgDevName
output prodResourceGroup string = rgProdName

output acaEnvDevName string = acaEnvDevName
output acaEnvProdName string = acaEnvProdName

output devFqdns array = containerAppsDev.outputs.fqdns
output prodFqdns array = containerAppsProd.outputs.fqdns
