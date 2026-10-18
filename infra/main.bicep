// Azure Container Apps deployment for the car-lease onboarding PoC.
//
//   Container Apps environment (VNet-integrated, Consumption workload profile)
//   ├── <prefix>-worker   Temporal worker + SQLite        no ingress, exactly 1 replica
//   ├── <prefix>-api      HTTP API                        external HTTPS ingress
//   ├── <prefix>-mocks    mock external services          internal HTTP ingress
//   └── temporalMode = 'devserver' only:
//       ├── <prefix>-temporal   Temporal dev server (in-memory!)   internal TCP ingress :7233
//       └── <prefix>-temporal-ui Temporal Web UI               external ingress, IP-restricted
//
// Deploy with infra/deploy.sh (creates the registry, builds the image in ACR, deploys the apps).

@description('Short lowercase prefix for resource names (letters/digits, max 12 chars).')
@maxLength(12)
param prefix string = 'carlease'

param location string = resourceGroup().location

@description('"devserver" runs an ephemeral Temporal dev server inside the environment (demo only). "cloud" uses Temporal Cloud.')
@allowed(['devserver', 'cloud'])
param temporalMode string = 'devserver'

@description('Temporal Cloud endpoint, e.g. my-ns.a1b2c.tmprl.cloud:7233 (temporalMode = cloud).')
param temporalCloudAddress string = ''

@description('Temporal Cloud namespace, e.g. my-ns.a1b2c (temporalMode = cloud).')
param temporalCloudNamespace string = ''

@secure()
@description('Temporal Cloud API key (temporalMode = cloud).')
param temporalCloudApiKey string = ''

@description('Public IP / CIDR allowed to open the Temporal UI (devserver mode). Empty = do not deploy the UI.')
param temporalUiAllowedIp string = ''

@description('Set to false for the first pass, before the image has been pushed to the registry.')
param deployApps bool = true

param imageTag string = 'latest'

@description('Optional JSON override for the mock services chaos settings.')
param mockChaos string = ''

var useDevServer = temporalMode == 'devserver'
var suffix = uniqueString(resourceGroup().id)
var image = '${acr.properties.loginServer}/car-lease-onboarding:${imageTag}'
var temporalAppName = '${prefix}-temporal'
var temporalAddress = useDevServer ? '${temporalAppName}:7233' : temporalCloudAddress
var temporalNamespace = useDevServer ? 'default' : temporalCloudNamespace
var mocksAppName = '${prefix}-mocks'

// --- Shared infrastructure ---------------------------------------------------------------------

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs-${suffix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: '${prefix}${suffix}'
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-apps'
  location: location
}

// AcrPull for the apps' identity
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, 'AcrPull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// A custom VNet is required for TCP ingress (used by the Temporal dev server's gRPC port).
resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: '${prefix}-vnet'
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
    subnets: [
      {
        name: 'container-apps'
        properties: {
          addressPrefix: '10.40.0.0/23'
          delegations: [{ name: 'container-apps', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
    ]
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: vnet.properties.subnets[0].id
      internal: false
    }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
  }
}

// --- Apps ----------------------------------------------------------------------------------------

var registries = [{ server: acr.properties.loginServer, identity: identity.id }]
var appIdentity = {
  type: 'UserAssigned'
  userAssignedIdentities: { '${identity.id}': {} }
}
var temporalSecrets = useDevServer ? [] : [{ name: 'temporal-api-key', value: temporalCloudApiKey }]
var temporalEnv = concat(
  [
    { name: 'TEMPORAL_ADDRESS', value: temporalAddress }
    { name: 'TEMPORAL_NAMESPACE', value: temporalNamespace }
    { name: 'TASK_QUEUE', value: 'car-lease-onboarding' }
  ],
  useDevServer ? [] : [{ name: 'TEMPORAL_API_KEY', secretRef: 'temporal-api-key' }]
)

resource temporal 'Microsoft.App/containerApps@2024-03-01' = if (deployApps && useDevServer) {
  name: temporalAppName
  location: location
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      ingress: {
        external: false
        transport: 'tcp'
        targetPort: 7233
        exposedPort: 7233
      }
    }
    template: {
      containers: [
        {
          name: 'temporal'
          image: 'docker.io/temporalio/temporal:1.9.1'
          // In-memory persistence: all workflow state is lost when this replica restarts. Demo only.
          args: ['server', 'start-dev', '--ip', '0.0.0.0', '--headless']
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

resource temporalUi 'Microsoft.App/containerApps@2024-03-01' = if (deployApps && useDevServer && !empty(temporalUiAllowedIp)) {
  name: '${prefix}-temporal-ui'
  location: location
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        ipSecurityRestrictions: [
          { name: 'allowed', action: 'Allow', ipAddressRange: temporalUiAllowedIp }
        ]
      }
    }
    template: {
      containers: [
        {
          name: 'temporal-ui'
          image: 'docker.io/temporalio/ui:2.54.1'
          env: [
            { name: 'TEMPORAL_ADDRESS', value: temporalAddress }
          ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [temporal]
}

resource mocks 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: mocksAppName
  location: location
  identity: appIdentity
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      registries: registries
      ingress: {
        external: false
        targetPort: 8081
        allowInsecure: true // plain http://<app-name> calls from inside the environment
      }
    }
    template: {
      containers: [
        {
          name: 'mocks'
          image: image
          command: ['node', 'dist/mock-services/server.js']
          env: [
            { name: 'MOCK_PORT', value: '8081' }
            { name: 'MOCK_CHAOS', value: mockChaos }
          ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      // Exactly one replica: the chaos settings and call counters live in memory.
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [acrPull]
}

resource worker 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: '${prefix}-worker'
  location: location
  identity: appIdentity
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      registries: registries
      secrets: temporalSecrets
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: image
          command: ['node', 'dist/worker.js']
          env: concat(temporalEnv, [
            { name: 'MOCK_SERVICES_URL', value: 'http://${mocksAppName}' }
            { name: 'DB_PATH', value: '/app/data/leasing.db' }
          ])
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
      // SQLite lives on the replica's local disk: keep exactly one replica. The file is lost when
      // the replica is replaced - swap to Azure SQL / Postgres beyond the PoC.
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [acrPull, temporal, mocks]
}

resource api 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: '${prefix}-api'
  location: location
  identity: appIdentity
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      registries: registries
      secrets: temporalSecrets
      ingress: {
        external: true
        targetPort: 3000
      }
    }
    template: {
      containers: [
        {
          name: 'api'
          image: image
          command: ['node', 'dist/api/server.js']
          env: concat(temporalEnv, [{ name: 'PORT', value: '3000' }])
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          probes: [
            { type: 'Readiness', httpGet: { path: '/health', port: 3000 } }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
  dependsOn: [acrPull, temporal]
}

output registryName string = acr.name
output registryLoginServer string = acr.properties.loginServer
output apiUrl string = deployApps ? 'https://${api!.properties.configuration.ingress.fqdn}' : ''
output temporalUiUrl string = (deployApps && useDevServer && !empty(temporalUiAllowedIp))
  ? 'https://${temporalUi!.properties.configuration.ingress.fqdn}'
  : ''
