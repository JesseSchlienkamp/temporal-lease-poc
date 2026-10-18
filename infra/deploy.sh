#!/usr/bin/env bash
# Deploys the PoC to Azure Container Apps. Requires the Azure CLI (`az login` first); no local Docker needed.
#
#   ./infra/deploy.sh                                   # Temporal dev server inside Azure (demo)
#   TEMPORAL_MODE=cloud \
#   TEMPORAL_CLOUD_ADDRESS=my-ns.a1b2c.tmprl.cloud:7233 \
#   TEMPORAL_CLOUD_NAMESPACE=my-ns.a1b2c \
#   TEMPORAL_CLOUD_API_KEY=... ./infra/deploy.sh        # Temporal Cloud
set -euo pipefail
cd "$(dirname "$0")/.."

RESOURCE_GROUP=${RESOURCE_GROUP:-rg-carlease-poc}
LOCATION=${LOCATION:-westeurope}
PREFIX=${PREFIX:-carlease}
TEMPORAL_MODE=${TEMPORAL_MODE:-devserver}
IMAGE_TAG=${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}

common_params=(
  prefix="$PREFIX"
  temporalMode="$TEMPORAL_MODE"
  temporalCloudAddress="${TEMPORAL_CLOUD_ADDRESS:-}"
  temporalCloudNamespace="${TEMPORAL_CLOUD_NAMESPACE:-}"
  temporalCloudApiKey="${TEMPORAL_CLOUD_API_KEY:-}"
)

echo "==> Resource group $RESOURCE_GROUP ($LOCATION)"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

echo "==> Shared infrastructure (registry, environment, identity)"
REGISTRY=$(az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file infra/main.bicep \
  --parameters "${common_params[@]}" deployApps=false \
  --query properties.outputs.registryName.value --output tsv)

echo "==> Building image in ACR $REGISTRY (linux/amd64)"
az acr build --registry "$REGISTRY" --image "car-lease-onboarding:$IMAGE_TAG" --platform linux/amd64 .

MY_IP=$(curl -fsS https://api.ipify.org || true)
echo "==> Container apps (Temporal UI restricted to ${MY_IP:-nobody})"
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file infra/main.bicep \
  --parameters "${common_params[@]}" deployApps=true imageTag="$IMAGE_TAG" temporalUiAllowedIp="${MY_IP:+$MY_IP/32}" \
  --query "properties.outputs.{api: apiUrl.value, temporalUi: temporalUiUrl.value}" --output table
