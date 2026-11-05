# DevSpace Local Proving Ground

Slice 0 establishes a standalone local proving ground for the later runtime-platform refactor.

It is intentionally separate from `src/project/execution.ts` and the runtime/provider abstractions.
The goal here is only to prove that a realistic multi-repo app can be deployed locally with DevSpace and validated end-to-end in a boring, repeatable way.

## Canonical fixture repos

The proving ground uses these reference fixture repos and nothing else:

- `reference/devspace-fixture-workspace`
- `reference/devspace-fixture-frontend`
- `reference/devspace-fixture-gateway`
- `reference/devspace-fixture-backend`

The shared app shape is:

- React frontend repo
- Apollo GraphQL gateway repo
- FastAPI backend repo
- Postgres dependency

The canonical journey is one request through the whole stack:

`frontend -> gateway -> backend -> postgres`

The seeded todo title is `Ship release checklist`.

## Prerequisites on macOS

Install the host tools explicitly:

```bash
brew install kubectl minikube devspace kind
brew install --cask docker
```

Then start Docker Desktop and verify the daemon is reachable:

```bash
docker info >/dev/null
```

## Primary path: Minikube

Bootstrap the canonical local cluster:

```bash
./scripts/devspace/bootstrap-minikube-macos.sh
```

That script starts profile `piphony-devspace`, switches `kubectl` to it, and prints cluster info.

Run the standalone proving-ground smoke:

```bash
npm run smoke:devspace-local
```

Useful overrides:

```bash
PIPHONY_DEVSPACE_CLUSTER=minikube \
PIPHONY_DEVSPACE_NAMESPACE=piphony-devspace \
PIPHONY_DEVSPACE_MINIKUBE_PROFILE=piphony-devspace \
PIPHONY_DEVSPACE_IMAGE_TAG=smoke \
npm run smoke:devspace-local
```

The smoke will:

1. materialize the reference fixture repos into one temp root
2. ensure the target cluster exists
3. deploy the shared workspace with DevSpace
4. wait for the stack and validate the frontend-rendered todo page
5. purge the workspace and delete the namespace
6. remove the temp fixture root

## Kind fallback

Kind is acceptable, but it is explicit rather than hidden.

Bootstrap a local kind cluster:

```bash
./scripts/devspace/bootstrap-kind-macos.sh
```

Run the same smoke against kind by opting in:

```bash
PIPHONY_DEVSPACE_CLUSTER=kind \
PIPHONY_DEVSPACE_KIND_CLUSTER_NAME=piphony-devspace \
npm run smoke:devspace-local
```

The workspace prepare script handles the kind-specific image load path by:

1. building the three fixture images with DevSpace
2. loading those images into the named kind cluster
3. running `devspace deploy --skip-build`

## Manual workspace scripts

After cloning/materializing the four fixture repos into one shared directory, the workspace repo owns the boring manual commands:

```bash
cd devspace-fixture-workspace
DEVSPACE_FIXTURE_KUBE_CONTEXT=piphony-devspace ./scripts/prepare.sh
DEVSPACE_FIXTURE_KUBE_CONTEXT=piphony-devspace ./scripts/validate.sh
DEVSPACE_FIXTURE_KUBE_CONTEXT=piphony-devspace ./scripts/teardown.sh
```

For kind, set `DEVSPACE_FIXTURE_CLUSTER=kind` and `DEVSPACE_FIXTURE_KIND_CLUSTER_NAME` when running `prepare.sh`.

## Cleanup and reset

To remove the workspace namespace and delete the whole local cluster:

```bash
./scripts/devspace/reset-local-cluster.sh minikube
./scripts/devspace/reset-local-cluster.sh kind
```

If only the deployed workspace is stale, the smoke teardown already calls:

- `reference/devspace-fixture-workspace/scripts/teardown.sh`
- namespace deletion verification through `kubectl`

## Notes

- `npm run smoke:devspace-local` is registered as a standalone manual/live smoke only.
- It is not part of `smoke:all`.
- It is not part of `validate:main` in Slice 0.
- This slice does not wire DevSpace into core runtime contracts yet.
