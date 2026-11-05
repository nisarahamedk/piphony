#!/usr/bin/env bash
set -euo pipefail

namespace=${DEVSPACE_FIXTURE_NAMESPACE:-piphony-devspace}
kube_context=${DEVSPACE_FIXTURE_KUBE_CONTEXT:-$(kubectl config current-context)}
frontend_port=${DEVSPACE_FIXTURE_FRONTEND_PORT:-18080}
expected_title=${DEVSPACE_FIXTURE_EXPECTED_TITLE:-Ship release checklist}

kubectl --context "$kube_context" -n "$namespace" rollout status deployment/postgres --timeout=180s
kubectl --context "$kube_context" -n "$namespace" rollout status deployment/backend --timeout=180s
kubectl --context "$kube_context" -n "$namespace" rollout status deployment/gateway --timeout=180s
kubectl --context "$kube_context" -n "$namespace" rollout status deployment/frontend --timeout=180s

port_forward_log=$(mktemp)
kubectl --context "$kube_context" -n "$namespace" port-forward svc/frontend "$frontend_port:3000" >"$port_forward_log" 2>&1 &
port_forward_pid=$!
cleanup() {
  if kill -0 "$port_forward_pid" >/dev/null 2>&1; then
    kill "$port_forward_pid"
    wait "$port_forward_pid" || true
  fi
  rm -f "$port_forward_log"
}
trap cleanup EXIT

for attempt in $(seq 1 60); do
  html=$(curl -fsS "http://127.0.0.1:$frontend_port/" 2>/dev/null || echo "")
  if [[ -n "$html" && "$html" == *"$expected_title"* && "$html" == *"gateway"* && "$html" == *"backend"* ]]; then
    echo "fixture_validation_ok"
    exit 0
  fi
  sleep 2
  if ! kill -0 "$port_forward_pid" >/dev/null 2>&1; then
    echo "frontend port-forward exited early" >&2
    cat "$port_forward_log" >&2
    exit 1
  fi
  if [[ "$attempt" -eq 60 ]]; then
    echo "Timed out waiting for expected frontend HTML" >&2
    echo "Last response:" >&2
    echo "$html" >&2
    echo "Port-forward log:" >&2
    cat "$port_forward_log" >&2
    exit 1
  fi
done
