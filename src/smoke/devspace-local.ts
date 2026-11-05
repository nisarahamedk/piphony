import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { attemptCleanup, errorMessage } from "../core/index.js";
import { cloneDevSpaceFixtureProject } from "../fixtures/devspace-fixture.js";
import { pickAvailablePort } from "../fixtures/project.js";

const SMOKE_COMMAND = "npm run smoke:devspace-local";

type ClusterKind = "minikube" | "kind";

interface SmokeConfig {
  cluster: ClusterKind;
  namespace: string;
  minikubeProfile: string;
  minikubeDriver: string;
  minikubeCpus: string;
  minikubeMemory: string;
  kindClusterName: string;
  imageTag: string;
  expectedTitle: string;
  frontendPort?: number;
}

interface ClusterTarget {
  kind: ClusterKind;
  context: string;
}

interface RunCommandOptions {
  label: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

class CommandFailureError extends Error {
  constructor(
    readonly label: string,
    readonly command: string,
    readonly args: string[],
    readonly exitCode: number,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(`${label} failed with exit code ${exitCode}`);
  }
}

class ExternalDependencyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const config = resolveSmokeConfig(process.env);
const frontendPort = config.frontendPort ?? await pickAvailablePort();
let fixture: Awaited<ReturnType<typeof cloneDevSpaceFixtureProject>> | undefined;
let clusterTarget: ClusterTarget | undefined;
let primaryError: unknown;
let finalError: unknown;
let externalSkip: ExternalDependencyError | undefined;
let workspaceTornDown = false;
let fixtureCleaned = false;

try {
  await ensurePrerequisites(config);
  clusterTarget = await ensureCluster(config);
  fixture = await cloneDevSpaceFixtureProject();

  const commandEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DEVSPACE_FIXTURE_CLUSTER: config.cluster,
    DEVSPACE_FIXTURE_NAMESPACE: config.namespace,
    DEVSPACE_FIXTURE_KUBE_CONTEXT: clusterTarget.context,
    DEVSPACE_FIXTURE_KIND_CLUSTER_NAME: config.kindClusterName,
    DEVSPACE_FIXTURE_IMAGE_TAG: config.imageTag,
    DEVSPACE_FIXTURE_EXPECTED_TITLE: config.expectedTitle,
    DEVSPACE_FIXTURE_FRONTEND_PORT: String(frontendPort),
  };

  await runCheckedCommand({
    label: "devspace_fixture.prepare",
    command: "bash",
    args: ["scripts/prepare.sh"],
    cwd: fixture.workspaceRoot,
    env: commandEnv,
    timeoutMs: 20 * 60 * 1000,
  });

  await runCheckedCommand({
    label: "devspace_fixture.validate",
    command: "bash",
    args: ["scripts/validate.sh"],
    cwd: fixture.workspaceRoot,
    env: commandEnv,
    timeoutMs: 10 * 60 * 1000,
  });

  await runCheckedCommand({
    label: "devspace_fixture.teardown",
    command: "bash",
    args: ["scripts/teardown.sh"],
    cwd: fixture.workspaceRoot,
    env: commandEnv,
    timeoutMs: 10 * 60 * 1000,
  });
  workspaceTornDown = true;

  await verifyNamespaceDeleted(clusterTarget.context, config.namespace);
  await fixture.cleanup();
  fixtureCleaned = true;
  await verifyPathDeleted(fixture.tempRoot);

  console.log(JSON.stringify({
    ok: true,
    smoke: "devspace-local",
    cluster: config.cluster,
    context: clusterTarget.context,
    namespace: config.namespace,
    frontendPort,
  }, null, 2));
} catch (error) {
  primaryError = error;
  if (error instanceof ExternalDependencyError) {
    externalSkip = error;
  } else {
    finalError = error;
  }
} finally {
  if (fixture !== undefined && clusterTarget !== undefined) {
    const workspaceFixture = fixture;
    const target = clusterTarget;
    const commandEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DEVSPACE_FIXTURE_CLUSTER: config.cluster,
      DEVSPACE_FIXTURE_NAMESPACE: config.namespace,
      DEVSPACE_FIXTURE_KUBE_CONTEXT: target.context,
      DEVSPACE_FIXTURE_KIND_CLUSTER_NAME: config.kindClusterName,
      DEVSPACE_FIXTURE_IMAGE_TAG: config.imageTag,
      DEVSPACE_FIXTURE_EXPECTED_TITLE: config.expectedTitle,
      DEVSPACE_FIXTURE_FRONTEND_PORT: String(frontendPort),
    };

    if (!workspaceTornDown) {
      await attemptCleanup(
        "smoke.devspace_local.workspace.teardown",
        async () => {
          await runCheckedCommand({
            label: "devspace_fixture.teardown.cleanup",
            command: "bash",
            args: ["scripts/teardown.sh"],
            cwd: workspaceFixture.workspaceRoot,
            env: commandEnv,
            timeoutMs: 10 * 60 * 1000,
          });
        },
        (failure) => {
          console.error("devspace_local_teardown_cleanup_failed", failure);
        },
        workspaceFixture.workspaceRoot,
      );
    }

    if (primaryError === undefined) {
      await verifyNamespaceDeleted(target.context, config.namespace);
    } else {
      await attemptCleanup(
        "smoke.devspace_local.namespace.verify",
        async () => {
          await verifyNamespaceDeleted(target.context, config.namespace);
        },
        (failure) => {
          console.error("devspace_local_namespace_verify_failed", failure);
        },
        config.namespace,
      );
    }
  }

  if (fixture !== undefined && !fixtureCleaned) {
    const cleanupFixture = fixture;
    await attemptCleanup(
      "smoke.devspace_local.fixture.cleanup",
      () => cleanupFixture.cleanup(),
      async (failure) => {
        console.error("devspace_local_fixture_cleanup_failed", failure);
      },
      cleanupFixture.tempRoot,
    );

    if (primaryError === undefined) {
      await verifyPathDeleted(cleanupFixture.tempRoot);
    } else {
      await attemptCleanup(
        "smoke.devspace_local.fixture.verify",
        () => verifyPathDeleted(cleanupFixture.tempRoot),
        (failure) => {
          console.error("devspace_local_fixture_verify_failed", failure);
        },
        cleanupFixture.tempRoot,
      );
    }
  }
}

if (externalSkip !== undefined) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: externalSkip.code,
    command: SMOKE_COMMAND,
    error: externalSkip.message,
  }, null, 2));
  process.exit(0);
}

if (finalError !== undefined) {
  throw finalError;
}

function resolveSmokeConfig(env: NodeJS.ProcessEnv): SmokeConfig {
  const cluster = env.PIPHONY_DEVSPACE_CLUSTER === "kind" ? "kind" : "minikube";
  return {
    cluster,
    namespace: env.PIPHONY_DEVSPACE_NAMESPACE?.trim() || "piphony-devspace",
    minikubeProfile: env.PIPHONY_DEVSPACE_MINIKUBE_PROFILE?.trim() || "piphony-devspace",
    minikubeDriver: env.PIPHONY_DEVSPACE_MINIKUBE_DRIVER?.trim() || "docker",
    minikubeCpus: env.PIPHONY_DEVSPACE_MINIKUBE_CPUS?.trim() || "4",
    minikubeMemory: env.PIPHONY_DEVSPACE_MINIKUBE_MEMORY?.trim() || "8192",
    kindClusterName: env.PIPHONY_DEVSPACE_KIND_CLUSTER_NAME?.trim() || "piphony-devspace",
    imageTag: env.PIPHONY_DEVSPACE_IMAGE_TAG?.trim() || "smoke",
    expectedTitle: env.PIPHONY_DEVSPACE_EXPECTED_TITLE?.trim() || "Ship release checklist",
    ...(env.PIPHONY_DEVSPACE_FRONTEND_PORT?.trim() === undefined || env.PIPHONY_DEVSPACE_FRONTEND_PORT?.trim() === ""
      ? {}
      : { frontendPort: Number(env.PIPHONY_DEVSPACE_FRONTEND_PORT) }),
  };
}

async function ensurePrerequisites(config: SmokeConfig): Promise<void> {
  await ensureCommandAvailable("git");
  await ensureCommandAvailable("docker");
  await ensureCommandAvailable("kubectl");
  await ensureCommandAvailable("curl");
  await ensureCommandAvailable("devspace");
  if (config.cluster === "minikube") {
    await ensureCommandAvailable("minikube");
  }
  if (config.cluster === "kind") {
    await ensureCommandAvailable("kind");
  }

  try {
    await runCommand({
      label: "docker.info",
      command: "docker",
      args: ["info"],
      timeoutMs: 30_000,
    });
  } catch (error) {
    const message = commandFailureOutput(error);
    throw new ExternalDependencyError("docker_unavailable", `Docker daemon is unavailable: ${message}`);
  }
}

async function ensureCommandAvailable(command: string): Promise<void> {
  try {
    await runCommand({
      label: `command.${command}`,
      command: "bash",
      args: ["-lc", `command -v ${command}`],
      timeoutMs: 15_000,
    });
  } catch (error) {
    throw new ExternalDependencyError(`${command}_unavailable`, `Missing required command '${command}' for ${SMOKE_COMMAND}`);
  }
}

async function ensureCluster(config: SmokeConfig): Promise<ClusterTarget> {
  return config.cluster === "kind" ? ensureKindCluster(config) : ensureMinikubeCluster(config);
}

async function ensureMinikubeCluster(config: SmokeConfig): Promise<ClusterTarget> {
  const statusResult = await runCommandAllowFailure({
    label: "minikube.status",
    command: "minikube",
    args: ["status", "--profile", config.minikubeProfile],
    timeoutMs: 30_000,
  });

  if (statusResult.exitCode !== 0 || !/host:\s+running/i.test(statusResult.stdout + statusResult.stderr)) {
    try {
      await runCheckedCommand({
        label: "minikube.start",
        command: "minikube",
        args: [
          "start",
          "--profile",
          config.minikubeProfile,
          "--driver",
          config.minikubeDriver,
          "--cpus",
          config.minikubeCpus,
          "--memory",
          config.minikubeMemory,
        ],
        timeoutMs: 20 * 60 * 1000,
      });
    } catch (error) {
      throw new ExternalDependencyError("minikube_unavailable", `Failed to start Minikube: ${commandFailureOutput(error)}`);
    }
  }

  await runCheckedCommand({
    label: "minikube.update_context",
    command: "minikube",
    args: ["-p", config.minikubeProfile, "update-context"],
    timeoutMs: 60_000,
  });
  await waitForKubectlContext(config.minikubeProfile);

  return {
    kind: "minikube",
    context: config.minikubeProfile,
  };
}

async function ensureKindCluster(config: SmokeConfig): Promise<ClusterTarget> {
  const clusterName = config.kindClusterName;
  const clusters = await runCheckedCommand({
    label: "kind.get_clusters",
    command: "kind",
    args: ["get", "clusters"],
    timeoutMs: 30_000,
  });

  if (!clusters.stdout.split(/\r?\n/).map((line) => line.trim()).includes(clusterName)) {
    try {
      await runCheckedCommand({
        label: "kind.create",
        command: "kind",
        args: ["create", "cluster", "--name", clusterName, "--wait", "120s"],
        timeoutMs: 10 * 60 * 1000,
      });
    } catch (error) {
      throw new ExternalDependencyError("kind_unavailable", `Failed to create kind cluster: ${commandFailureOutput(error)}`);
    }
  }

  const context = `kind-${clusterName}`;
  await waitForKubectlContext(context);
  return {
    kind: "kind",
    context,
  };
}

async function waitForKubectlContext(context: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await runCommandAllowFailure({
      label: "kubectl.cluster_info",
      command: "kubectl",
      args: ["--context", context, "cluster-info"],
      timeoutMs: 30_000,
    });
    if (result.exitCode === 0) {
      return;
    }
    await sleep(2_000);
  }
  throw new ExternalDependencyError("kubectl_unavailable", `kubectl could not reach cluster context '${context}'`);
}

async function verifyNamespaceDeleted(context: string, namespace: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await runCommandAllowFailure({
      label: "kubectl.namespace.verify_deleted",
      command: "kubectl",
      args: ["--context", context, "get", "namespace", namespace],
      timeoutMs: 15_000,
    });
    if (result.exitCode !== 0) {
      return;
    }
    await sleep(2_000);
  }
  throw new Error(`Namespace ${namespace} still exists after teardown`);
}

async function verifyPathDeleted(path: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    return;
  }
  throw new Error(`Temporary fixture path still exists after cleanup: ${path}`);
}

async function runCheckedCommand(options: RunCommandOptions): Promise<{ stdout: string; stderr: string }> {
  try {
    return await runCommand(options);
  } catch (error) {
    throw maybeExternalDependencyError(error);
  }
}

function maybeExternalDependencyError(error: unknown): unknown {
  const output = commandFailureOutput(error);
  if (output === "") {
    return error;
  }
  if (/Cannot connect to the Docker daemon/i.test(output) || /docker daemon.*running/i.test(output)) {
    return new ExternalDependencyError("docker_unavailable", output);
  }
  if (/command not found/i.test(output)) {
    return new ExternalDependencyError("tool_unavailable", output);
  }
  return error;
}

function commandFailureOutput(error: unknown): string {
  if (error instanceof CommandFailureError) {
    return [error.stderr, error.stdout].filter(Boolean).join("\n").trim();
  }
  return errorMessage(error);
}

async function runCommand(options: RunCommandOptions): Promise<{ stdout: string; stderr: string }> {
  console.log(`\n==> ${options.label}: ${options.command} ${options.args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timeout = options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          if (finished) {
            return;
          }
          child.kill("SIGTERM");
        }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (finished) {
        return;
      }
      finished = true;
      reject(error);
    });
    child.on("close", (code) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (finished) {
        return;
      }
      finished = true;
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new CommandFailureError(options.label, options.command, options.args, code ?? 1, stdout, stderr));
    });
  });
}

async function runCommandAllowFailure(options: RunCommandOptions): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const result = await runCommand(options);
    return {
      exitCode: 0,
      ...result,
    };
  } catch (error) {
    if (error instanceof CommandFailureError) {
      return {
        exitCode: error.exitCode,
        stdout: error.stdout,
        stderr: error.stderr,
      };
    }
    throw error;
  }
}
