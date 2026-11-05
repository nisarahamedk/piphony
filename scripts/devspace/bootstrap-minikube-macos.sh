#!/usr/bin/env bash
set -euo pipefail

profile=${1:-piphony-devspace}
driver=${PIPHONY_DEVSPACE_MINIKUBE_DRIVER:-docker}
cpus=${PIPHONY_DEVSPACE_MINIKUBE_CPUS:-4}
memory=${PIPHONY_DEVSPACE_MINIKUBE_MEMORY:-8192}

minikube start \
  --driver="$driver" \
  --profile "$profile" \
  --cpus "$cpus" \
  --memory "$memory"
minikube -p "$profile" update-context
kubectl config use-context "$profile"
kubectl cluster-info --context "$profile"
