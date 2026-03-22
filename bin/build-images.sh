#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

REGISTRY="${REGISTRY:-clab}"
TAG="${TAG:-latest}"

echo "Building Control Plane..."
docker build -t "${REGISTRY}/control-plane:${TAG}" ./control-plane/

echo "Building Knowledge Service..."
docker build -t "${REGISTRY}/knowledge-service:${TAG}" ./knowledge-server/

echo "Building Dashboard..."
docker build -t "${REGISTRY}/dashboard:${TAG}" ./apps/dashboard/

echo ""
echo "Images built:"
echo "  ${REGISTRY}/control-plane:${TAG}"
echo "  ${REGISTRY}/knowledge-service:${TAG}"
echo "  ${REGISTRY}/dashboard:${TAG}"
