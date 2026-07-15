# Devpost Submission — SentinelOps Society

> Draft submission package for the Global AI Hackathon with Qwen Cloud.
> Copy the sections below into the Devpost "Enter a Submission" form.

## Track

**Track 4: Autopilot Agent**

## Elevator pitch (short)

An autonomous incident-response autopilot: from a raw, ambiguous production alert to an executed remediation and a NIS2-compliant report — with Qwen function calling for real tool use and a deterministic policy engine that decides when a human must sign off.

## Text description (features & functionality)

**The problem.** When production breaks, incident response is a human scramble: read a vague alert, grep logs, guess a root cause, argue about the fix — then, days later, write the compliance report. For EU companies, NIS2 (Directive 2022/2555) now makes that report a legal obligation with strict deadlines (24h early warning / 72h notification / 1-month final report).

**The agent.** SentinelOps Society automates that workflow end-to-end with five Qwen-powered agents on Alibaba Cloud Function Compute:

1. **Le Sentinelle** ingests *ambiguous inputs* — a monitoring email, a panicked Slack message, a webhook payload, free text — and normalizes them into a structured, severity-classified alert (ANSSI P1–P4).
2. **L'Inspecteur** investigates through a genuine agentic loop using **Qwen native function calling**: the model decides which observability tools to call (`get_logs`, `get_metrics`, `get_recent_deployments`, `get_service_dependencies`), results are fed back, and every invocation lands in an audit trail. Tools are deterministic simulators with documented adapter seams for Alibaba Cloud SLS and CloudMonitor.
3. **L'Analyste** produces a root-cause analysis with a calibrated confidence score and explicitly rejected alternative hypotheses.
4. **L'Opérateur** emits a human-readable plan *and* machine-executable actions constrained to a whitelisted tool registry — the LLM cannot invent new write-paths into production.
5. **Le Rapporteur** writes the NIS2/ANSSI post-incident report (GDPR check, notification deadlines, MTTR/MTTD).

**Human-in-the-loop by design.** A deterministic policy engine — not the model — gates every remediation: critical risk → RSSI+DSI approval, medium → DSI, low risk on a P1 or a low-confidence diagnosis → DSI, otherwise auto-execute. Pending incidents pause at a checkpoint until a human approves or rejects via the API or the one-click dashboard panel. A hallucinated "low risk" on a P1 incident still stops at the human gate.

**Production-readiness.** Retry with exponential backoff and timeouts on every Qwen call, strict JSON extraction with fallbacks, SSE live streaming of the agent timeline, per-incident token telemetry, bounded in-memory store, offline mock mode, and a Serverless Devs manifest (`s.yaml`) for one-command Function Compute deployment.

## How the project was significantly updated during the Submission Period

The project was substantially rebuilt during the Submission Period (July 2026):

- Added **Qwen native function calling**: a full agentic tool loop for the investigation agent, with a tool registry and per-call audit trail (previously the investigation was a single prompt with simulated log excerpts).
- Added a **real human-in-the-loop workflow**: deterministic policy engine, `pending_approval` state, approve/reject API endpoints, and a remediation execution phase (previously approval was only a flag in the response).
- Added **ambiguous-input ingestion** (raw email/Slack/webhook text normalization).
- Built the **SOC dashboard** with live SSE timeline, approval panel, and NIS2 report rendering.
- Added retries/backoff/timeouts, JSON-validation guardrails, token telemetry, offline mock mode, Serverless Devs deployment manifest, and full documentation.

## Proof of Alibaba Cloud deployment (code links)

- `src/qwenClient.ts` — Qwen via DashScope (`dashscope-intl.aliyuncs.com`, OpenAI-compatible mode), including native function calling.
- `s.yaml` — Serverless Devs manifest for Alibaba Cloud Function Compute 3.0 (custom runtime, HTTP trigger).
- `src/tools/registry.ts` — documented adapter seams for Alibaba Cloud SLS (logs) and CloudMonitor (metrics).

## Architecture diagram

See the Mermaid diagram in [README.md](README.md#%EF%B8%8F-architecture) (rendered natively by GitHub).

## Testing instructions (for judges)

No API key or cloud account is required to evaluate the full workflow:

```bash
git clone https://github.com/aleobois-arch/sentinels.git
cd sentinels
npm install
npm run demo          # offline mock mode — full pipeline incl. HITL approval
# open http://localhost:9000
```

In the dashboard, click the sample button **"Exemple : message Slack ambigu"** then **"🚨 Déclencher la société d'agents"** to see: ambiguous-input normalization → live tool calls → root cause → policy gate → approval panel → execution → NIS2 report. (The product UI and agent outputs are deliberately in French — the target market is French/EU regulated enterprises; all documentation and testing instructions are in English.)

To run against live Qwen Cloud: put a DashScope key in `.env` (`cp .env.example .env`) and run `npm run build && npm start`.

## Video

- [ ] TODO: record the 3-minute demo (script scene-by-scene in README § "3-minute demo script"), upload to YouTube/Vimeo/Youku as **public**, paste the link here and in the Devpost form. Use English voice-over or subtitles.

## Open source license

MIT — `LICENSE` at the repository root (auto-detected by GitHub and shown in the About sidebar).
