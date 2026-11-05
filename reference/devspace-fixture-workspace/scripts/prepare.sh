#!/usr/bin/env bash
set -euo pipefail

workspace_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
namespace=${DEVSPACE_FIXTURE_NAMESPACE:-piphony-devspace}
kube_context=${DEVSPACE_FIXTURE_KUBE_CONTEXT:-$(kubectl config current-context)}
cluster=${DEVSPACE_FIXTURE_CLUSTER:-minikube}
kind_cluster_name=${DEVSPACE_FIXTURE_KIND_CLUSTER_NAME:-piphony-devspace}
tag=${DEVSPACE_FIXTURE_IMAGE_TAG:-smoke}

cd "$workspace_root"

if ! kubectl --context "$kube_context" get namespace "$namespace" >/dev/null 2>&1; then
  kubectl --context "$kube_context" create namespace "$namespace"
fi

if [[ "$cluster" == "kind" ]]; then
  devspace build \
    --kube-context "$kube_context" \
    --namespace "$namespace" \
    --tag "$tag" \
    --skip-push \
    --no-warn

  kind load docker-image --name "$kind_cluster_name" \
    "piphony/devspace-fixture-frontend:$tag" \
    "piphony/devspace-fixture-gateway:$tag" \
    "piphony/devspace-fixture-backend:$tag"

  devspace deploy \
    --kube-context "$kube_context" \
    --namespace "$namespace" \
    --tag "$tag" \
    --skip-build \
    --force-deploy \
    --no-warn
  exit 0
fi

devspace deploy \
  --kube-context "$kube_context" \
  --namespace "$namespace" \
  --tag "$tag" \
  --skip-push \
  --force-build \
  --force-deploy \
  --no-warn
