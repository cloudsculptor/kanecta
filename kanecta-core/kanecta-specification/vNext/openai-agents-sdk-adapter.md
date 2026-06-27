# OpenAI Agents SDK adapter

The OpenAI Agents SDK is MIT licensed, open source, and maintained by OpenAI. It is their first-party answer to multi-agent orchestration, built around three primitives: agents (an LLM + instructions + tools), handoffs (one agent passing control to another), and guardrails (fast parallel validation of inputs and outputs). Well-designed for simple delegation patterns with excellent first-party tracing if you are already on OpenAI models.

See also [[langgraph-adapter]] for the more powerful orchestration comparison, and [[crewai]] if the role/crew model is relevant.

---

## Where the OpenAI Agents SDK is strong

**Handoffs** are the SDK's most elegant primitive. An agent can hand off mid-task to a specialised agent, passing full context cleanly. Simpler to express than LangGraph edges for linear delegation — if Agent A determines it needs a specialist, it calls a handoff and control transfers. No graph definition required upfront.

**Guardrails** are a neat safety mechanism — a fast, cheap validation model runs in parallel with the main agent and can trip a wire if the input or output is out of bounds. This is faster than a sequential validation step because it runs concurrently.

**First-party tracing** integrates directly with the OpenAI dashboard — very good out of the box if you are an OpenAI shop and want zero-config observability.

**Simplicity** — for a two- or three-agent delegation pattern, the SDK is the fastest path to running code. Less ceremony than LangGraph or CrewAI.

---

## Where Kanecta wins

| Concern | OpenAI Agents SDK | Kanecta |
|---------|------------------|---------|
| Persistent state | None — run evaporates on process end | pipeline-run item, fully queryable |
| Run history | OpenAI dashboard only | pipeline-run items in your datastore |
| Cycles | Not native — handoffs are one-directional | loopBack |
| Fan-out | Not native | forEach |
| Fan-in | Not native | fanIn |
| Confidence gates | Not native | confidenceGate, pauseAfter |
| Evals | Not native | eval + eval-run items with llm-judge |
| Multi-provider | OpenAI-first; workarounds needed | runtime is an open string — any model |
| Pipeline as queryable data | No — code only | pipeline item in the datastore |
| Non-technical editing | No | Studio |

Handoffs map to Kanecta's `fallbackAgentId` (conditional escalation) and `group-chat` runtime (multi-agent deliberation). Guardrails map to a validation phase with `pauseAfter` or a `confidenceGate`, or to an eval assertion — and unlike SDK guardrails, a Kanecta validation failure is a tracked, queryable event on the run record.

---

## Adapter concept (`runtime: "openai-agents"`)

A Kanecta agent runtime adapter that wraps an OpenAI Agents SDK run inside a Kanecta pipeline phase. The runner invokes the SDK, captures the output, and writes produced items to Kanecta. Handoffs that happen inside the SDK run are internal to that phase — Kanecta sees the final output, not the intermediate delegation steps.

This is useful for teams with existing OpenAI Agents SDK code who want to wrap it in Kanecta's orchestration and persistence layer without rewriting their agent logic.

```json
{
  "runtime": "openai-agents",
  "model": "gpt-4o",
  "systemPrompt": null,
  "tools": ["kanecta_add_item"],
  "config": {
    "entryAgentId": "<openai-sdk-agent-id>",
    "maxTurns": 10,
    "guardrails": true
  }
}
```

`config.entryAgentId` — the ID of the SDK agent to invoke as the entry point. Handoffs within the SDK run proceed normally. The adapter captures all items written via `kanecta_add_item` during the SDK run and records them in `itemsProduced` on the phase record.

`config.guardrails: true` — enables SDK-level guardrail validation before and after the run. If a guardrail trips, the phase is set to `"failed"` with the guardrail reason in `error`. The team can then add a Kanecta `pauseAfter` or `confidenceGate` on top for additional Kanecta-native control.

---

## The handoff → Kanecta pipeline translation

Teams migrating from the OpenAI Agents SDK to native Kanecta pipelines should map their agent topology as follows:

| OpenAI Agents SDK concept | Kanecta equivalent |
|--------------------------|-------------------|
| Agent (LLM + instructions + tools) | `agent` item with `agentPayload` |
| Handoff to specialist | `fallbackAgentId` (conditional on "escalate" tag) or explicit phase with `runIf` |
| Multi-agent group | `runtime: "group-chat"` with `config.participants` |
| Guardrail (input validation) | A preceding phase with `confidenceGate` or `pauseAfter` |
| Guardrail (output validation) | An eval assertion (`payload` type or `llm-judge`) |
| Sequential handoff chain | Pipeline phases with `needs` |
| Tracing dashboard | pipeline-run items + Studio pipeline view |

---

## Why provider lock-in matters

The OpenAI Agents SDK is optimised for GPT-4o and the OpenAI tool-use API. Using Claude, Gemini, or an open-source model requires adapters that are not first-class in the SDK. Kanecta's `runtime` field is an open string — `"claude-api"`, `"claude-code"`, a local Ollama instance, or any future model — with no preference baked in. As the model landscape evolves (and it will), Kanecta pipelines are not coupled to any one provider.

---

## Open questions

- Should the adapter expose individual SDK handoff steps as sub-phase records on the pipeline-run, similar to forEach invocations? This would make the SDK's internal delegation visible in Studio rather than opaque.
- The SDK's guardrail model (fast parallel validation) is architecturally different from Kanecta's sequential gate model. Is there value in adding a `guardRail` field to pipeline phases that runs a cheap validation agent in parallel — tripping the phase to `"failed"` without waiting for the main agent to finish? This would be a direct equivalent of the SDK primitive and worth a vNext spec addition.
