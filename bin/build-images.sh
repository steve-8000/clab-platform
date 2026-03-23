#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

REGISTRY="${REGISTRY:-clab}"
TAG="${TAG:-latest}"

echo "Building Memory Gateway..."
docker build -t "${REGISTRY}/knowledge-service:${TAG}" ./knowledge-server/

echo ""
echo "Images built:"
echo "  ${REGISTRY}/knowledge-service:${TAG}"
