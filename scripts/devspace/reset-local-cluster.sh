#!/usr/bin/env bash
set -euo pipefail

cluster_type=${1:-minikube}
cluster_name=${2:-piphony-devspace}
namespace=${PIPHONY_DEVSPACE_NAMESPACE:-piphony-devspace}

case "$cluster_type" in
  minikube)
    context="$cluster_name"
    if kubectl config get-contexts "$context" >/dev/null 2>&1; then
      kubectl --context "$context" delete namespace "$namespace" --ignore-not-found=true --wait=true --timeout=180s
    fi
    minikube delete --profile "$cluster_name"
    ;;
  kind)
    context="kind-$cluster_name"
    if kubectl config get-contexts "$context" >/dev/null 2>&1; then
      kubectl --context "$context" delete namespace "$namespace" --ignore-not-found=true --wait=true --timeout=180s
    fi
    kind delete cluster --name "$cluster_name"
    ;;
  *)
    echo "Usage: $0 <minikube|kind> [cluster-name]" >&2
    exit 1
    ;;
esac
