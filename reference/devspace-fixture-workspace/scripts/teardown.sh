#!/usr/bin/env bash
set -euo pipefail

workspace_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
namespace=${DEVSPACE_FIXTURE_NAMESPACE:-piphony-devspace}
kube_context=${DEVSPACE_FIXTURE_KUBE_CONTEXT:-$(kubectl config current-context)}
tag=${DEVSPACE_FIXTURE_IMAGE_TAG:-smoke}

cd "$workspace_root"

devspace purge \
  --kube-context "$kube_context" \
  --namespace "$namespace" \
  --tag "$tag" \
  --force-purge \
  --skip-build \
  --no-warn

if kubectl --context "$kube_context" get namespace "$namespace" >/dev/null 2>&1; then
  kubectl --context "$kube_context" delete namespace "$namespace" --wait=true --timeout=180s
fi
