import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";

interface ExplainerStep {
  id: string;
  title: string;
  explanation: string;
  codeSnippet?: string;
  highlightLines?: number[];
  relatedFiles?: string[];
  deeperDives?: { question: string; answer: string }[];
}

interface State {
  currentStep: number;
  visitedSteps: number[];
  questions: { question: string; answer?: string; timestamp: number }[];
  completed: boolean;
}

export default function (pi: ExtensionAPI) {
  let server: http.Server | null = null;
  let port = 3456;
  let state: State = {
    currentStep: 0,
    visitedSteps: [],
    questions: [],
    completed: false,
  };
  let resolveWait: ((value: string) => void) | null = null;

  async function findPort(startPort: number): Promise<number> {
    return new Promise((resolve) => {
      const testServer = http.createServer();
      testServer.listen(startPort, () => {
        testServer.close(() => resolve(startPort));
      });
      testServer.on("error", () => {
        resolve(findPort(startPort + 1));
      });
    });
  }

  // Generate the guided walkthrough HTML - BLOCKING VERSION
  function generateWalkthroughHTML(steps: ExplainerStep[], state: State): string {
    const current = steps[state.currentStep];
    const totalSteps = steps.length;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Walkthrough</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0f0f0f;
      --surface: #1a1a1a;
      --surface-elevated: #242424;
      --border: #333;
      --text: #e5e5e5;
      --text-dim: #888;
      --accent: #ff6b35;
      --accent-dim: #ff6b3540;
      --success: #4ade80;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 48px 24px;
    }

    .progress {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--surface);
    }

    .progress-bar {
      height: 100%;
      background: var(--accent);
      transition: width 0.3s ease;
    }

    .header {
      text-align: center;
      margin-bottom: 48px;
    }

    .step-indicator {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: var(--text-dim);
      margin-bottom: 16px;
    }

    .title {
      font-family: 'Instrument Serif', serif;
      font-size: 42px;
      font-weight: 400;
      line-height: 1.2;
    }

    .content {
      display: grid;
      gap: 32px;
    }

    .explanation {
      font-size: 18px;
      line-height: 1.8;
    }

    .explanation p {
      margin-bottom: 16px;
    }

    .explanation strong {
      color: var(--accent);
      font-weight: 600;
    }

    .explanation code {
      background: var(--surface-elevated);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
    }

    .code-block {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }

    .code-header {
      padding: 12px 16px;
      background: var(--surface-elevated);
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      color: var(--text-dim);
      font-family: 'JetBrains Mono', monospace;
    }

    .code-content {
      padding: 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      line-height: 1.6;
      overflow-x: auto;
    }

    .code-line {
      display: flex;
    }

    .line-num {
      width: 40px;
      color: var(--text-dim);
      text-align: right;
      padding-right: 16px;
      user-select: none;
      opacity: 0.5;
    }

    .line-content {
      flex: 1;
    }

    .line-highlight {
      background: var(--accent-dim);
      border-radius: 2px;
    }

    .nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 48px;
      padding-top: 32px;
      border-top: 1px solid var(--border);
    }

    .nav-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 24px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .nav-btn:hover {
      background: var(--surface-elevated);
      border-color: var(--accent);
    }

    .nav-btn.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }

    .nav-btn.primary:hover {
      background: #ff8255;
    }

    .nav-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .step-dots {
      display: flex;
      gap: 8px;
    }

    .step-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--border);
      cursor: pointer;
      transition: all 0.2s;
    }

    .step-dot.active {
      background: var(--accent);
      transform: scale(1.25);
    }

    .step-dot.visited {
      background: var(--text-dim);
    }

    .questions-section {
      margin-top: 48px;
      padding: 24px;
      background: var(--surface);
      border-radius: 12px;
    }

    .questions-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    .question-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .question-input {
      width: 100%;
      padding: 12px 16px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 14px;
      font-family: inherit;
      resize: vertical;
      min-height: 80px;
    }

    .question-input:focus {
      outline: none;
      border-color: var(--accent);
    }

    .question-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .ask-btn {
      padding: 10px 24px;
      background: var(--accent);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }

    .ask-btn:hover { background: #ff8255; }

    .complete-btn {
      padding: 12px 32px;
      background: var(--success);
      border: none;
      border-radius: 8px;
      color: #000;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .complete-btn:hover { transform: scale(1.02); }

    .questions-list {
      margin-top: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .question-item {
      padding: 16px;
      background: var(--surface-elevated);
      border-radius: 8px;
      border-left: 3px solid var(--accent);
    }

    .question-text {
      font-size: 14px;
      margin-bottom: 8px;
    }

    .question-answer {
      font-size: 13px;
      color: var(--text-dim);
      padding-top: 8px;
      border-top: 1px solid var(--border);
    }

    .suggestions {
      margin-top: 16px;
    }

    .suggestions-label {
      font-size: 12px;
      color: var(--text-dim);
      margin-bottom: 8px;
    }

    .suggestion-btn {
      display: inline-block;
      padding: 6px 12px;
      background: var(--surface-elevated);
      border: 1px solid var(--border);
      border-radius: 16px;
      font-size: 12px;
      color: var(--text-dim);
      margin-right: 8px;
      cursor: pointer;
    }

    .suggestion-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
    }

    .status-banner {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--surface-elevated);
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }

    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--success);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <div class="progress">
    <div class="progress-bar" style="width: ${((state.currentStep + 1) / totalSteps) * 100}%"></div>
  </div>

  <div class="container">
    <div class="header">
      <div class="step-indicator">Step ${state.currentStep + 1} of ${totalSteps}</div>
      <h1 class="title">${current.title}</h1>
    </div>

    <div class="content">
      <div class="explanation">
        ${current.explanation.split('\n\n').map(p => `<p>${p}</p>`).join('')}
      </div>

      ${current.codeSnippet ? `
        <div class="code-block">
          <div class="code-header">${current.relatedFiles?.[0] || 'Code'}</div>
          <div class="code-content">
            ${current.codeSnippet.split('\n').map((line, i) => {
              const lineNum = i + 1;
              const highlighted = current.highlightLines?.includes(lineNum);
              return `<div class="code-line ${highlighted ? 'line-highlight' : ''}">
                <div class="line-num">${lineNum}</div>
                <div class="line-content">${escapeHtml(line)}</div>
              </div>`;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${current.deeperDives && current.deeperDives.length > 0 ? `
        <div class="suggestions">
          <div class="suggestions-label">Deeper dives available:</div>
          ${current.deeperDives.map((dive, i) => `
            <button class="suggestion-btn" onclick="showDive(${state.currentStep}, ${i})">${dive.question}</button>
          `).join('')}
        </div>
      ` : ''}
    </div>

    <div class="nav">
      <button class="nav-btn" onclick="prevStep()" ${state.currentStep === 0 ? 'disabled' : ''}>
        ← Previous
      </button>

      <div class="step-dots">
        ${steps.map((_, i) => `
          <div class="step-dot ${i === state.currentStep ? 'active' : ''} ${state.visitedSteps.includes(i) ? 'visited' : ''}" 
               onclick="goToStep(${i})"></div>
        `).join('')}
      </div>

      <button class="nav-btn primary" onclick="nextStep()" ${state.currentStep === totalSteps - 1 ? 'disabled' : ''}>
        Next →
      </button>
    </div>

    <div class="questions-section">
      <div class="questions-title">💬 Ask follow-up questions</div>
      <div class="question-form">
        <textarea class="question-input" id="questionInput" placeholder="e.g., How does the polling work? What happens when a worker fails?"></textarea>
        <div class="question-actions">
          <button class="ask-btn" onclick="askQuestion()">Ask Question</button>
        </div>
      </div>
      <div class="questions-list" id="questionsList"></div>
    </div>

    <div style="text-align: center; margin-top: 48px;">
      <button class="complete-btn" onclick="completeWalkthrough()">
        ✓ I've reviewed the walkthrough - continue
      </button>
    </div>
  </div>

  <div class="status-banner">
    <div class="status-dot"></div>
    <span>Review the walkthrough, then click "Continue" when ready</span>
  </div>

  <script>
    const steps = ${JSON.stringify(steps)};
    let state = ${JSON.stringify(state)};

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function updateState(newState) {
      state = newState;
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      });
    }

    function prevStep() {
      if (state.currentStep > 0) {
        updateState({ ...state, currentStep: state.currentStep - 1 });
        location.reload();
      }
    }

    function nextStep() {
      if (state.currentStep < steps.length - 1) {
        const newVisited = [...new Set([...state.visitedSteps, state.currentStep])];
        updateState({ ...state, currentStep: state.currentStep + 1, visitedSteps: newVisited });
        location.reload();
      }
    }

    function goToStep(index) {
      updateState({ ...state, currentStep: index });
      location.reload();
    }

    function showDive(stepIndex, diveIndex) {
      const step = steps[stepIndex];
      const dive = step.deeperDives[diveIndex];
      alert(dive.answer);
    }

    async function askQuestion() {
      const input = document.getElementById('questionInput');
      const question = input.value.trim();
      if (!question) return;

      await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          question, 
          currentStep: state.currentStep,
          currentTitle: steps[state.currentStep].title
        })
      });

      input.value = '';
      loadQuestions();
    }

    async function loadQuestions() {
      try {
        const res = await fetch('/api/questions');
        const data = await res.json();
        const list = document.getElementById('questionsList');
        
        if (data.questions.length === 0) {
          list.innerHTML = '<div style="color: var(--text-dim); font-size: 13px;">No questions yet</div>';
          return;
        }

        list.innerHTML = data.questions.map(q => \`
          <div class="question-item">
            <div class="question-text">\${escapeHtml(q.question)}</div>
            \${q.answer ? \`<div class="question-answer">\${escapeHtml(q.answer)}</div>\` : ''}
          </div>
        \`).join('');
      } catch (e) {}
    }

    async function completeWalkthrough() {
      await fetch('/api/complete', { method: 'POST' });
      alert('Walkthrough complete! You can now continue in pi.');
    }

    loadQuestions();
    setInterval(loadQuestions, 2000);
  </script>
</body>
</html>`;
  }

  // Build walkthrough steps
  function buildWalkthrough(projectPath: string): ExplainerStep[] {
    const steps: ExplainerStep[] = [];
    const srcPath = path.join(projectPath, "src");

    steps.push({
      id: "overview",
      title: "What is Piphony?",
      explanation: `**Piphony** is an autonomous issue-processing system built on the pi coding agent framework.

It continuously polls an issue tracker (like GitHub Issues), picks up work items, and dispatches them to a worker that executes the actual task.

The system tracks progress, handles failures, and reports status back to a web UI and browser extension.`,
      deeperDives: [
        { question: "What's the difference between an issue and a work item?", answer: "An 'issue' is the raw format from the tracker. A 'WorkItem' is a normalized internal representation." },
        { question: "What trackers are supported?", answer: "Currently a local file-based tracker. Implement TrackerAdapter for GitHub, Jira, Linear, etc." }
      ]
    });

    const typesPath = path.join(srcPath, "core/types.ts");
    if (fs.existsSync(typesPath)) {
      const content = fs.readFileSync(typesPath, "utf-8");
      const lines = content.split("\n").slice(0, 35).join("\n");
      steps.push({
        id: "types",
        title: "Core Data Types",
        explanation: `**types.ts** defines the core interfaces:

- **WorkItem** — Normalized issue representation
- **TrackerAdapter** — Interface for fetching/mutating work items  
- **RuntimeProvider** — Interface for isolated execution (Docker)
- **RunWorker** — The worker that processes work items

State machine: backlog → todo → in_progress → human_review → rework → merging → done (or cancelled)`,
        codeSnippet: lines,
        highlightLines: [1, 8, 15, 28],
        relatedFiles: ["src/core/types.ts"],
        deeperDives: [
          { question: "What are active vs terminal states?", answer: "Active: todo, in_progress, rework, merging (can be picked up). Terminal: done, cancelled (final)." },
          { question: "What's the priority ranking?", answer: "Critical(0) → High(1) → Medium(2) → Low(3). Sorted by priority first, then by createdAt." }
        ]
      });
    }

    const orchPath = path.join(srcPath, "core/orchestrator.ts");
    if (fs.existsSync(orchPath)) {
      const content = fs.readFileSync(orchPath, "utf-8");
      const lines = content.split("\n").slice(89, 125).join("\n");
      steps.push({
        id: "orchestrator",
        title: "The Orchestrator Engine",
        explanation: `The **Orchestrator** runs a loop:

1. **Poll** — Fetch candidate work items
2. **Filter** — Re-validate each candidate
3. **Prioritize** — Sort by priority then creation time
4. **Dispatch** — Create run record and spawn worker
5. **Track** — Monitor heartbeat and status
6. **Cleanup** — Remove completed runs

Supports both single-run (runOnce) and continuous mode (pollOnce in loop).`,
        codeSnippet: lines,
        highlightLines: [1, 3, 4, 5, 6, 8],
        relatedFiles: ["src/core/orchestrator.ts"],
        deeperDives: [
          { question: "How does heartbeat work?", answer: "Workers call heartbeat() periodically, updating lastSeenAt and phase. activeRunRegistry and statusSink track these." },
          { question: "What if a worker crashes?", answer: "reconcileRunningWorkers() cleans up settled entries. Could add stale detection via lastSeenAt." }
        ]
      });
    }

    const execPath = path.join(srcPath, "core/orchestrator-run-executor.ts");
    if (fs.existsSync(execPath)) {
      const content = fs.readFileSync(execPath, "utf-8");
      const lines = content.split("\n").slice(0, 30).join("\n");
      steps.push({
        id: "run-executor",
        title: "Run Execution Flow",
        explanation: `**orchestrator-run-executor.ts** handles execution:

1. **Prepare** — Set up runtime (Docker container)
2. **Branch** — Create git branch for work item
3. **Execute** — Run the worker with the work item
4. **Transition** — Update work item state based on result
5. **Collect** — Gather any artifacts produced
6. **Cleanup** — Destroy the runtime`,
        codeSnippet: lines,
        highlightLines: [1, 5, 10, 15, 20, 25],
        relatedFiles: ["src/core/orchestrator-run-executor.ts"],
        deeperDives: [
          { question: "How does it integrate with the pi agent?", answer: "worker.execute() calls into pi-coding-agent SDK to run the agent on the work item." },
          { question: "What artifacts are collected?", answer: "runtimeProvider.collectArtifacts() gathers files produced during execution." }
        ]
      });
    }

    const adapterPath = path.join(srcPath, "tracker/local/adapter.ts");
    if (fs.existsSync(adapterPath)) {
      const content = fs.readFileSync(adapterPath, "utf-8");
      const lines = content.split("\n").slice(0, 25).join("\n");
      steps.push({
        id: "tracker",
        title: "Local File-Based Tracker",
        explanation: `The **local tracker adapter** stores work items in JSON files:

- **fetchCandidateWorkItems()** — Returns active state items
- **applyMutation()** — Transitions to new state
- **appendComment()** — Adds a comment
- **attachArtifact()** — Links a file

Data lives in state.ts — a JSON file with all work items, comments, and artifacts.`,
        codeSnippet: lines,
        highlightLines: [1, 5, 10, 15, 20],
        relatedFiles: ["src/tracker/local/adapter.ts"],
        deeperDives: [
          { question: "How do I add a GitHub adapter?", answer: "Implement TrackerAdapter using GitHub REST API. Fetch via GET /repos/{owner}/{repo}/issues." },
          { question: "Can I use multiple trackers?", answer: "Yes! Create a MultiTracker that aggregates from multiple sources." }
        ]
      });
    }

    steps.push({
      id: "observability",
      title: "Observability & Logging",
      explanation: `The **logger** writes run data to filesystem:

- **runsRootDir/<runId>/** — Each run gets its own directory
- **summary.json** — Status, error info, final summary
- **transcript.json** — Full event log with timestamps
- **artifacts/** — Files produced during the run

Events flow to status sinks for real-time UI updates.`,
      deeperDives: [
        { question: "How does the web UI get real-time updates?", answer: "statusSink publishes OrchestratorSnapshots. UI polls or uses WebSockets." },
        { question: "Summary vs transcript?", answer: "Summary is structured JSON with key fields. Transcript is full event log." }
      ]
    });

    steps.push({
      id: "web-ui",
      title: "Web UI Architecture",
      explanation: `The **web UI** is React + TanStack Start:

- **Framework**: TanStack Start (file-based routing)
- **State**: TanStack Query for data fetching
- **Server**: Hono (fast Node.js server)

Shows run status, allows browsing runs, displays work item details. The other half is the browser extension.`,
      deeperDives: [
        { question: "How does web UI communicate with backend?", answer: "Hono exposes REST endpoints. React fetches via TanStack Query with caching." },
        { question: "What's the browser extension for?", answer: "Pop-up on repo pages showing run status, triggering runs, viewing details." }
      ]
    });

    steps.push({
      id: "summary",
      title: "Architecture Summary",
      explanation: `**Data Flow:**
Tracker → TrackerAdapter → Orchestrator → RunWorker → RuntimeProvider → Observability → StatusSink → Web UI/Extension

**Key Patterns:**
- **Adapter pattern** — Abstract trackers/runtimes
- **State machine** — Canonical work item states
- **Heartbeat** — Workers report progress
- **Artifact collection** — Capture all output

Swap in different trackers, runtimes, or workers without changing core logic.`,
      deeperDives: [
        { question: "Where do I start customizing?", answer: "New tracker: implement TrackerAdapter. New runtime: implement RuntimeProvider. New worker: implement RunWorker." },
        { question: "How do I add a smoke test?", answer: "Look at src/smoke/ — standalone scripts that exercise components." }
      ]
    });

    return steps;
  }

  // Create server
  function createServer(projectPath: string) {
    const steps = buildWalkthrough(projectPath);

    return http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${port}`);

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(generateWalkthroughHTML(steps, state));
        return;
      }

      if (url.pathname === "/api/state") {
        if (req.method === "POST") {
          let body = "";
          req.on("data", chunk => body += chunk);
          req.on("end", () => {
            try {
              state = JSON.parse(body);
              res.writeHead(200);
              res.end(JSON.stringify({ success: true }));
            } catch {
              res.writeHead(400);
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
        }
        return;
      }

      if (url.pathname === "/api/questions") {
        if (req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ questions: state.questions }));
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", chunk => body += chunk);
          req.on("end", () => {
            try {
              const data = JSON.parse(body);
              state.questions.push({ question: data.question, timestamp: Date.now() });

              pi.sendMessage({
                customType: "code-walkthrough",
                content: `**Question about "${data.currentTitle}":** ${data.question}`,
                display: true,
              });

              res.writeHead(200);
              res.end(JSON.stringify({ success: true }));
            } catch {
              res.writeHead(400);
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
        }
        return;
      }

      // COMPLETE endpoint - signals pi to resume
      if (url.pathname === "/api/complete" && req.method === "POST") {
        state.completed = true;
        if (resolveWait) {
          resolveWait("completed");
          resolveWait = null;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });
  }

  // BLOCKING command - waits for completion
  pi.registerCommand("walkthrough", {
    description: "Open interactive code walkthrough (blocking)",
    handler: async (args, ctx) => {
      const projectPath = args || ctx.cwd;

      port = await findPort(3456);
      server = createServer(projectPath);

      await new Promise<void>((resolve) => {
        server!.listen(port, () => resolve());
      });

      const { exec } = await import("node:child_process");
      exec(`open http://localhost:${port}`);

      ctx.ui.notify(`📖 Walkthrough open at http://localhost:${port}\n\nClick "Continue" in the browser when done.`, "info");

      // BLOCKING WAIT - poll for completion
      while (!state.completed) {
        await new Promise(r => setTimeout(r, 1000));
        
        // Check if session was interrupted
        if (ctx.isIdle?.()) {
          // User might have typed something else
          break;
        }
      }

      // Reset for next time
      state = {
        currentStep: 0,
        visitedSteps: [],
        questions: [],
        completed: false,
      };

      // Prompt the user to continue
      return "I've completed the walkthrough. What would you like to explore next?";
    },
  });

  pi.on("session_shutdown", async () => {
    if (server) {
      server.close();
      server = null;
    }
  });
}