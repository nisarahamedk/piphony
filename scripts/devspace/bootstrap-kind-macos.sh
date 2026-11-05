#!/usr/bin/env bash
set -euo pipefail

cluster_name=${1:-piphony-devspace}
context="kind-$cluster_name"

if kind get clusters | grep -Fx "$cluster_name" >/dev/null 2>&1; then
  echo "kind cluster already exists: $cluster_name"
else
  kind create cluster --name "$cluster_name" --wait 120s
fi

kubectl config use-context "$context"
kubectl cluster-info --context "$context"
