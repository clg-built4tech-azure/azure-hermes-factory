// iam/rbac.bicep - All IAM role assignments for Hermes deployment
// Deployed at subscription scope — uses modules for RG/ACR-scoped assignments

targetScope = 'subscription'

@description('Service principal object ID')
param servicePrincipalObjectId string

@description('Dev resource group name')
param rgDevName string = 'rg-hermes-dev'

@description('Prod resource group name')
param rgProdName string = 'rg-hermes-prod'

@description('ACR name')
param acrName string = 'hermesagentdev'

// ──────────────────────────────────────────────
// Built-in role definition IDs
// ──────────────────────────────────────────────
var contributorRoleId = 'b24988ac-6180-42a0-ab88-20f7382dd24c'
var acrPushRoleId = '8311e382-0749-4cb8-b61a-304f252683d1'
var costManagementReaderRoleId = '72fafb67-81a3-46a6-b9c4-249ef2a6a5a6'
var monitoringReaderRoleId = '43d0d0ad-2537-4757-bf73-5a9e6892b0f5'

// Resource references
resource rgDev 'Microsoft.Resources/resourceGroups@2024-03-01' existing = {
  name: rgDevName
}

resource rgProd 'Microsoft.Resources/resourceGroups@2024-03-01' existing = {
  name: rgProdName
}

// ──────────────────────────────────────────────
// ACR-scoped: AcrPush (via module)
// ──────────────────────────────────────────────
module acrPush './modules/acr-role-assignment.bicep' = {
  name: 'acrPush'
  scope: rgDev
  params: {
    acrName: acrName
    roleDefinitionId: acrPushRoleId
    principalId: servicePrincipalObjectId
  }
}

// ──────────────────────────────────────────────
// RG-scoped: Contributor on dev (via module)
// ──────────────────────────────────────────────
module rgDevContributor './modules/role-assignment.bicep' = {
  name: 'rgDevContributor'
  scope: rgDev
  params: {
    roleName: 'Contributor'
    roleDefinitionId: contributorRoleId
    principalId: servicePrincipalObjectId
    scopeDescription: rgDevName
  }
}

// ──────────────────────────────────────────────
// RG-scoped: Contributor on prod (via module)
// ──────────────────────────────────────────────
module rgProdContributor './modules/role-assignment.bicep' = {
  name: 'rgProdContributor'
  scope: rgProd
  params: {
    roleName: 'Contributor'
    roleDefinitionId: contributorRoleId
    principalId: servicePrincipalObjectId
    scopeDescription: rgProdName
  }
}

// ──────────────────────────────────────────────
// Subscription-scoped: Cost Management Reader
// ──────────────────────────────────────────────
resource costManagementReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, servicePrincipalObjectId, costManagementReaderRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', costManagementReaderRoleId)
    principalId: servicePrincipalObjectId
    principalType: 'ServicePrincipal'
  }
}

// ──────────────────────────────────────────────
// Subscription-scoped: Monitoring Reader
// ──────────────────────────────────────────────
resource monitoringReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, servicePrincipalObjectId, monitoringReaderRoleId, 'monitoring')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringReaderRoleId)
    principalId: servicePrincipalObjectId
    principalType: 'ServicePrincipal'
  }
}
