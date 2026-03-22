#!/bin/bash
set -euo pipefail

echo "Port-forwarding clab services..."
kubectl port-forward -n clab svc/control-plane 8000:8000 &
kubectl port-forward -n clab svc/knowledge-service 4007:4007 &
kubectl port-forward -n clab svc/dashboard 3000:3000 &
echo "Active: CP=localhost:8000, KS=localhost:4007, Dashboard=localhost:3000"
echo "Press Ctrl+C to stop"
wait
