# Production North Star

This is not a refactor plan.

This is the standard the codebase must converge toward before Piphony is allowed to feel "production-ready."

It is intentionally opinionated.
It is intentionally stricter than the current codebase.
It is intentionally written so that it still applies if the current problem files are gone and a different slice of the system is under refactor.

If a future PR says "this file already looked messy so I followed the local pattern," this document wins.

---

## What this document is for

Piphony is moving from MVP experimentation toward software that must:
- run unattended
- coordinate long-lived work
- manipulate external systems
- preserve clear operational state
- fail loudly enough to debug
- stay understandable as the codebase grows

That means the bar is **not** "works today."
The bar is:

> a new engineer should be able to open any module and immediately see the canonical model, the canonical boundary, and the canonical failure mode.

If they instead see scattered local cleverness, optionality gymnastics, cleanup superstition, or hand-rolled serializers everywhere, we are not ready.

---

# 1. Non-negotiable design principles

## 1.1 One canonical shape per concept

Each important concept gets one primary shape.

Examples:
- a `WorkItem` has one canonical domain shape
- a `RunRecord` has one canonical persistence shape
- a `WorkerHeartbeat` has one canonical status/reporting shape
- a web/dashboard DTO has one canonical transport shape

We do **not** allow the same concept to be represented by:
- half-normalized input shapes
- partially serialized output shapes
- ad hoc metadata lookups
- fallback chains across three timestamps or three sources of truth

If callers have to remember which of `foo`, `fooId`, `fooIdentifier`, `fooMeta.foo`, `foo?.bar`, or `foo ?? fallback` is the real one, the model is broken.

### Rule
If multiple properties can represent the same fact, choose one canonical field and delete the ambiguity.

---

## 1.2 Normalize once, at the boundary

Normalization is allowed.
Distributed normalization is banned.

Good boundaries:
- CLI argument parsing
- env/config parsing
- HTTP/form request parsing
- persistence hydration
- external API adapters

Bad boundaries:
- random serializer functions
- deep domain services
- UI helper functions that re-normalize already-parsed data
- repeated `trim()` / `??` / `=== undefined` logic throughout the stack

### Rule
By the time data enters domain logic, it is already parsed, normalized, and validated.

---

## 1.3 Internal code should prefer required types

Optionality is expensive. Every optional field multiplies branches.

Optional fields are allowed when the domain itself is truly optional.
Optional fields are **not** allowed as a convenience to avoid deciding where defaults live.

### Required pattern
- system edges may accept partial input
- edge modules resolve defaults and validate
- internal constructors/services receive required, explicit inputs

### Forbidden pattern
A deep internal class taking `options?: { a?: number; b?: string; c?: Thing[] }` and resolving defaults itself.

That is edge logic pretending to be domain logic.

---

## 1.4 Error handling must preserve information

Piphony orchestrates real processes, runtimes, files, browsers, and agents.
Silent failure is unacceptable.

### Rule
Every caught error must do one of these:
1. convert into a richer domain error
2. record structured context and rethrow
3. record structured context and explicitly downgrade to best-effort behavior

### Forbidden pattern
```ts
await cleanup().catch(() => undefined)
```

If cleanup is best-effort, say so in code and log the failure.

---

## 1.5 Serialization is a boundary, not a coding style

We do not manually handcraft object literals full of conditional spreads across the codebase.
That is not architecture. That is repetitive ceremony.

### Rule
If a module serializes domain objects to transport/storage format, it should use one canonical serializer strategy.

Examples:
- `stripUndefined()` at transport boundaries
- dedicated DTO mappers
- schema-based serialization

What we do **not** do is make every file invent its own pattern.

---

## 1.6 Every subsystem must expose its lifecycle explicitly

Long-lived processes need real lifecycle semantics.

Examples:
- orchestrator state
- runtime provider state
- Pi session state
- worker state
- browser/smoke harness state

### Rule
If a component can be created, started, stopped, aborted, disposed, or fail mid-flight, then:
- its states must be explicit
- public methods must respect those states
- invalid transitions must fail predictably

A lonely `disposed = true` flag is not lifecycle design.
A real state machine is.

---

# 2. Architecture we are aiming for

## 2.1 The stack

The codebase should read as five clean layers:

### A. Domain
Pure concepts and rules.

Examples:
- work item states
- run status
- worker heartbeat semantics
- transition rules
- priority ordering

Domain code should not know about:
- env vars
- HTTP forms
- SQLite column nullability
- browser selectors
- Docker-specific cleanup details

### B. Adapters
Translate external systems into domain models.

Examples:
- local tracker adapter
- runtime provider adapter
- web request parsing
- Pi agent session integration

Adapters are where translation happens.
Adapters are **not** where business rules become ambiguous.

### C. Application services
Orchestrate domain actions.

Examples:
- orchestrator polling and dispatch
- workflow execution
- session control
- tracker mutations

Application services may coordinate several adapters, but should still operate on canonical internal types.

### D. Persistence / transport mappers
Take canonical models and write/read boundary formats.

Examples:
- SQLite row hydration
- run artifact JSON shapes
- dashboard DTOs
- event JSONL records

These modules should be boring and deterministic.

### E. UI / smoke / operational surfaces
Everything user-facing or ops-facing.

Examples:
- CLI commands
- web handlers
- smoke tests
- browser automation

These are allowed to be messy only in the ways their environment is messy. Not in their modeling.

#### Smoke fixture rule
Repo-touching smoke tests must run against an onboarded temporary fixture repo, not the Piphony repo itself.

Canonical pattern:
- clone a local reference repo into a temp directory
- onboard that temp repo
- point runtime surfaces at that temp repo via explicit project-root configuration
- write tracker/runs/artifacts inside that temp repo's `.piphony/`
- clean up only the processes and temp paths the smoke itself created

Forbidden pattern:
- using the Piphony package repo as the managed project under test
- broad `pkill` cleanup that can kill unrelated dev processes
- mixing package-root state with managed-project state in the same smoke run

---

## 2.2 One boundary, one responsibility

If a file both:
- parses env vars
- normalizes user input
- contains domain branching
- serializes storage output
- performs cleanup policy

then the file is doing too much.

A production-ready slice should let us point to a file and say, confidently:
- this is parsing
- this is orchestration
- this is storage mapping
- this is transport serialization
- this is cleanup policy

If we cannot name the boundary, the boundary is missing.

---

# 3. Hard rules for code shape

## 3.1 Ban local optional-object builders

### Current-state smell
From the current codebase:

```ts
const issue = withOptional(
  withOptional(
    {
      id: randomUUID(),
      identifier: input.identifier,
      title: input.title,
      state: input.state,
      labels: input.labels ?? [],
      url: `local://issues/${input.identifier}`,
      metadata: input.metadata ?? {},
      comments: [],
      artifacts: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    "description",
    input.description,
  ),
  "assignee",
  input.assignee,
) as LocalIssue;
```

This is not clean. It is a builder-shaped workaround for unclear serialization rules.

### North-star shape
Choose one of these and use it consistently:

```ts
const issue: LocalIssue = {
  id: randomUUID(),
  identifier: input.identifier,
  title: input.title,
  description: input.description,
  state: input.state,
  labels: input.labels,
  assignee: input.assignee,
  url: `local://issues/${input.identifier}`,
  metadata: input.metadata,
  comments: [],
  artifacts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};
```

or, if transport should omit undefined:

```ts
return stripUndefined({
  id: issue.id,
  identifier: issue.identifier,
  title: issue.title,
  description: issue.description,
  state: issue.state,
  assignee: issue.assignee,
});
```

### Rule
No nested optional-object builder chains. Ever.

---

## 3.2 Ban hand-written serializer gymnastics

### Current-state smell

```ts
return {
  id: issue.id,
  identifier: issue.identifier,
  title: issue.title,
  ...(description === undefined ? {} : { description }),
  state: issue.state,
  ...(assignee === undefined ? {} : { assignee }),
  ...(priority === undefined ? {} : { priority }),
  ...(branchName === undefined ? {} : { branchName }),
};
```

This pattern scales terribly and trains the codebase to be verbose by default.

### North-star shape

```ts
return toDashboardIssue(issue);
```

Where `toDashboardIssue()` is the single canonical DTO mapper for that boundary.

Or:

```ts
return stripUndefined({
  id: issue.id,
  identifier: issue.identifier,
  title: issue.title,
  description: issue.description,
  state: issue.state,
  assignee: issue.assignee,
  priority: issue.priority,
  branchName: issue.branchName,
});
```

### Rule
Conditional property omission belongs in a shared boundary utility or dedicated mapper, not inline in business code.

---

## 3.3 Ban repeated `instanceof Error ? error.message : String(error)`

### Current-state smell

```ts
error instanceof Error ? error.message : String(error)
```

This guard is legitimate.
The repetition is not.

### North-star shape

```ts
const message = errorMessage(error);
const stack = errorStack(error);
```

### Rule
Unknown thrown values are handled through shared error helpers. No copy-paste guards.

---

## 3.4 Ban silent best-effort cleanup

### Current-state smell

```ts
await this.options.runtimeProvider.stop().catch(() => undefined);
await this.options.runtimeProvider.destroy().catch(() => undefined);
```

### North-star shape

```ts
await attemptCleanup("runtime.stop", () => this.options.runtimeProvider.stop(), logger);
await attemptCleanup("runtime.destroy", () => this.options.runtimeProvider.destroy(), logger);
```

Where `attemptCleanup()`:
- records the operation name
- records the error
- does not hide that cleanup failed
- does not crash shutdown unless policy says it should

### Rule
Cleanup can be non-fatal. It cannot be invisible.

---

## 3.5 Ban deep option defaulting in internal services

### Current-state smell

```ts
constructor(private readonly options: OrchestratorOptions) {
  this.instanceId = options.instanceId ?? createRunId("orchestrator");
  this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
  this.maxConcurrentWorkers = options.maxConcurrentWorkers ?? 1;
}
```

This is tolerable at system edges. It is not the shape we want deep inside application services.

### North-star shape

```ts
const config = resolveOrchestratorConfig(env, cliArgs);
const orchestrator = new Orchestrator({
  tracker,
  worker,
  runsRootDir: config.runsRootDir,
  pollIntervalMs: config.pollIntervalMs,
  maxConcurrentWorkers: config.maxConcurrentWorkers,
  instanceId: config.instanceId,
});
```

And then internally:

```ts
interface OrchestratorConfig {
  tracker: TrackerAdapter;
  worker: RunWorker;
  runsRootDir: string;
  pollIntervalMs: number;
  maxConcurrentWorkers: number;
  instanceId: string;
}
```

### Rule
Resolve defaults at edges. Pass required config internally.

---

## 3.6 Ban fallback chains that hide model ambiguity

### Current-state smell

```ts
entry.workerHeartbeat?.lastSeenAt ?? entry.lastHeartbeatAt ?? entry.updatedAt
```

Maybe each fallback is understandable in isolation. Together they mean the model has no canonical truth.

### North-star shape

```ts
const lastSeenAt = entry.lastSeenAt;
```

or, if deriving state:

```ts
const lastSeenAt = deriveWorkerLastSeenAt(entry);
```

Where the derivation is centralized and documented.

### Rule
If callers repeatedly chain fallbacks to compute the same fact, that fact needs a real home.

---

## 3.7 Ban half-lifecycle components

### Current-state smell
A component exposes `dispose()` and sets `disposed = true`, but only some methods respect it.

### North-star shape

```ts
type SessionState =
  | { kind: "ready" }
  | { kind: "running" }
  | { kind: "aborting" }
  | { kind: "disposed" };
```

Public methods are legal only in allowed states.

### Rule
Lifecycle-sensitive components must either:
- fully enforce lifecycle rules, or
- be made simple enough that lifecycle enforcement is unnecessary

No middle ground.

---

# 4. Data modeling standards

## 4.1 Metadata is not a junk drawer

`metadata: Record<string, unknown>` is acceptable only at true extensibility boundaries.
It is not a substitute for deciding what the domain actually knows.

### Rule
If the code repeatedly reads `metadata.priority`, `metadata.branchName`, `metadata.prUrl`, those fields likely belong on a typed model.

### Production standard
Move stable, product-relevant fields out of `metadata` into explicit typed properties.
Keep `metadata` only for genuinely unstructured provider-specific extras.

---

## 4.2 Nullability policy must be explicit

We need one repo-wide stance on:
- `undefined`
- `null`
- omitted properties
- empty strings

### Production standard
- **Domain models:** prefer `undefined` for optional absence
- **Database rows:** use `null` only when storage requires it
- **Transport DTOs:** omit absent optional fields or use schema-defined nullable fields, but do it consistently
- **Forms/HTTP/CLI:** normalize `""` to `undefined` at input boundaries if the domain treats blank as absent

### Rule
No layer may leak its nullability conventions into another layer.

---

## 4.3 Derived fields must be derived once

Examples:
- worker staleness
- run summary preview text
- next suggested identifier
- issue priority display value

### Rule
Derived values should have a canonical derivation function, not ad hoc inline recomputation across modules.

---

# 5. Error handling and observability standards

## 5.1 Every important state transition must be observable

For production, the following must always be reconstructable from logs/artifacts:
- why a run started
- what it was working on
- what state transitions occurred
- whether runtime startup succeeded
- whether cleanup succeeded
- why it failed
- which artifacts were produced

If an operator cannot answer those from recorded output, the system is under-instrumented.

---

## 5.2 Errors need categories, not just strings

Eventually we need categories like:
- config error
- tracker error
- runtime startup error
- runtime exec error
- workflow error
- Pi session error
- cleanup error
- validation error

### Rule
If everything becomes `throw new Error("...")`, operators cannot reason about failure classes.

We do not need a giant enterprise exception hierarchy.
But we do need enough structure to distinguish cause categories.

---

## 5.3 Best-effort paths must still produce evidence

If we intentionally downgrade a failure, we should emit evidence like:
- operation name
- target
- error message
- error stack if present
- whether the system continued

"We tried and ignored it" is not acceptable.

---

# 6. Config standards

## 6.1 Config lives in one place per executable surface

Examples:
- orchestrator CLI config
- web server config
- runtime provider config
- smoke harness config

### Rule
No executable may read scattered env vars across arbitrary modules.

### North-star shape
Each executable surface has:
- one config module
- parsing
- validation
- defaults
- docs

---

## 6.2 Unsupported config should be impossible to miss

If an env var is accepted, it is documented.
If it is undocumented, it should not exist.

### Rule
No secret operational knobs living only in source code.

---

# 7. Persistence standards

## 7.1 Storage mapping must be dumb and explicit

SQLite row mappers and run artifact readers should not contain hidden business rules.

Hydration code is allowed to:
- convert `null` to `undefined`
- parse JSON columns
- map storage names to domain names

Hydration code is **not** allowed to:
- guess semantics from malformed inputs
- layer in business defaults that belong elsewhere
- normalize the same field three different ways in three different readers

---

## 7.2 Artifact shapes are contracts

Files like:
- `status.json`
- `summary.json`
- `events.jsonl`
- dashboard DTOs

are operational contracts.

### Rule
Once an artifact shape is declared canonical, all producers and consumers must use the same definition.

No duplicate near-equivalent shapes.
No "summary except in this file where we also add a maybe-field."

---

# 8. Testing standards

## 8.1 Smoke tests may be environment-flaky, not model-flaky

DOM selectors may be optional.
Browser timing may be messy.
External processes may require retries.
That is normal.

What is not normal is smoke code compensating for ambiguous product state.

### Rule
Smoke tests can defend against environment volatility.
They should not defend against our own unclear domain contracts.

---

## 8.2 Production-ready slices need invariant tests

For any refactored slice, tests should lock in invariants such as:
- only valid state transitions are possible
- serialization shape is stable
- config parsing rejects bad input
- cleanup helpers log and continue appropriately
- lifecycle components reject invalid operations after disposal/stop
- DTO mappers omit or include optional fields consistently

---

# 9. Code review laws

These are laws, not tips.

## Law 1: Do not copy adjacent bad patterns
A nearby file doing something ugly is not precedent.
It is debt.

## Law 2: If a PR adds a second way to do something, stop
Examples:
- second serialization style
- second error formatting idiom
- second config parsing location
- second lifecycle pattern
- second optional-field builder helper

## Law 3: If a caller needs to know too much about storage or transport, the boundary is wrong
Domain/application code should not care that SQLite uses `null` or JSON omits `undefined`.

## Law 4: If cleanup is important enough to do, it is important enough to observe
No invisible cleanup failures.

## Law 5: If a type is optional everywhere, it is probably wrong somewhere
Trace the uncertainty back to its source and fix it there.

## Law 6: If a helper exists only to compensate for noisy coding style, delete it
A helper should encode a real invariant or boundary rule, not make bad patterns easier to repeat.

## Law 7: Prefer boring code over clever code
A production codebase should feel obvious, not "elegant" in five incompatible ways.

---

# 10. Examples: current-state smell vs production-ready shape

## Example A: optional construction

### Smell
```ts
return withOptional(withOptional(base, "description", input.description), "assignee", input.assignee);
```

### Production-ready
```ts
return {
  ...base,
  description: input.description,
  assignee: input.assignee,
};
```

or at a transport boundary:

```ts
return stripUndefined({
  ...base,
  description: input.description,
  assignee: input.assignee,
});
```

The point is not syntax. The point is **one rule, used consistently**.

---

## Example B: repeated snapshot branching

### Smell
```ts
return this.usedModel === undefined
  ? { sessionId: this.session.sessionId, messageCount: this.session.messages.length }
  : { sessionId: this.session.sessionId, messageCount: this.session.messages.length, usedModel: this.usedModel };
```

### Production-ready
```ts
return stripUndefined({
  sessionId: this.session.sessionId,
  messageCount: this.session.messages.length,
  usedModel: this.usedModel,
});
```

---

## Example C: silent teardown

### Smell
```ts
await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
```

### Production-ready
```ts
await attemptCleanup("temp_dir.remove", () => rm(tempDir, { recursive: true, force: true }), logger);
```

---

## Example D: internal defaulting

### Smell
```ts
const intervalMs = Number(process.env.PIPHONY_POLL_INTERVAL_MS ?? 3000);
const maxConcurrentWorkers = Number(process.env.PIPHONY_MAX_CONCURRENT_WORKERS ?? 1);
```

This line by itself is not evil. The smell appears when the same executable has no config contract and other modules also invent config semantics.

### Production-ready
```ts
const config = parseOrchestratorConfig(process.env);
```

Then everything downstream receives typed, validated values.

---

## Example E: metadata dependence

### Smell
```ts
const priority = readIssueMeta(issue, "priority");
const branchName = readIssueMeta(issue, "branchName");
const prUrl = readIssueMeta(issue, "prUrl");
```

### Production-ready
```ts
interface WorkItem {
  // ...
  priority?: Priority;
  branchName?: string;
  prUrl?: string;
  metadata: Record<string, unknown>;
}
```

Stable fields are typed. Metadata remains for true extras.

---

# 11. Definition of done for a production-ready slice

A slice is production-ready when all of the following are true:

1. **Canonical models exist**
   - one obvious shape per concept
   - no repeated fallback logic to reconstruct meaning

2. **Boundaries are explicit**
   - parsing
   - normalization
   - application logic
   - persistence mapping
   - transport serialization

3. **Optionality is intentional**
   - not accidental
   - not propagated inward for convenience

4. **Errors are observable**
   - no swallowed failures
   - best-effort paths leave evidence

5. **Configuration is centralized**
   - typed
   - validated
   - documented

6. **Lifecycle is enforced**
   - no half-disposed or half-running abstractions

7. **Tests lock in invariants**
   - not just happy paths

8. **The code is boring in the right way**
   - obvious
   - regular
   - consistent across files

If a slice still requires a long verbal explanation for why its weird patterns are okay, it is not done.

---

# 12. Final standard

Before shipping to production, Piphony should feel like a system with:
- clear models
- strict boundaries
- visible failures
- centralized config
- explicit lifecycle semantics
- one obvious way to serialize, normalize, and report state

Not a system held together by many tiny defensive habits.

The north star is not "less defensive code."
It is:

> fewer scattered defenses, more explicit guarantees.

That is the difference between an MVP that happens to run and a production system that deserves trust.
