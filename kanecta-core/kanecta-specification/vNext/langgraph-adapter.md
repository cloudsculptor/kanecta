# LangGraph (and external orchestrator) adapter

## The idea

LangGraph nodes are plain functions — they can call Kanecta MCP tools (`kanecta_query`, `kanecta_add_item`, etc.) directly. This makes Kanecta a viable data layer for teams already invested in LangGraph (or CrewAI, or any other orchestration framework) without requiring them to adopt Kanecta pipelines as their execution engine.

The hybrid works well: LangGraph owns orchestration (typed state, cycles, edges, LangSmith observability), Kanecta owns domain data (items, relationships, tree, types, Studio visibility on outputs). Teams get LangGraph's maturity and Kanecta's data model in the same workflow.

## What you get without an adapter

- LangGraph nodes call `kanecta_add_item` to persist outputs as Kanecta items
- Results are visible in Studio alongside other domain data
- Relationships, types, parentId tree all work normally
- LangGraph state carries ephemeral values between nodes (no need for `kanecta_set_phase_output`)

## What you lose without an adapter

- The pipeline definition lives in Python/JS code, not as a Kanecta `pipeline` item — not queryable, not editable from Studio, not inspectable by other agents
- Run history lives in LangSmith, not in a Kanecta `pipeline-run` item — two places to look, not queryable alongside domain data
- The Studio pipeline view does not work (it reads `pipeline-run` items)
- Non-technical users cannot read or edit the workflow from Studio

## The adapter idea

A thin `kanecta-langgraph` adapter package that bridges LangGraph's runtime events to Kanecta's item model:

1. **At graph definition time** — serialise the LangGraph graph config into a Kanecta `pipeline` item (or update an existing one). The payload captures nodes, edges, and conditional logic in a human-readable form. This makes the workflow a first-class Kanecta item.

2. **At invocation time** — create a `pipeline-run` item. Map LangGraph's node lifecycle events (node started, node completed, state update) to phase status updates on the run record. Write `phases[].output` from LangGraph node return values. Handle interrupts by setting `gateResult: "blocked"` on the relevant phase.

3. **On completion** — set the run to `complete` or `failed`. All items produced by nodes during the run are already in Kanecta (the nodes wrote them). The run record ties it together.

With this adapter you get the best of both: LangGraph's orchestration maturity and the full Kanecta pipeline model — queryable run history, Studio pipeline view, pipeline definition as a living item.

## Why this matters as a product direction

Positions Kanecta as the canonical data layer for AI pipelines, agnostic to orchestration framework. Teams bring their own LangGraph / CrewAI / custom runner; the adapter keeps Kanecta as the source of truth for what ran, what it produced, and what it decided. This is a lower-friction on-ramp than asking teams to adopt Kanecta pipelines as their execution engine from day one.

The spec already defines `pipeline` and `pipeline-run` as structured types with full JSON schemas — the adapter is an implementation task, not a spec design task.

## Open questions

- How faithfully can a LangGraph graph be serialised into a `pipeline` item payload? LangGraph supports arbitrary Python functions as node logic — the serialised form would capture structure (nodes, edges, conditions) but not the full code.
- Should the adapter be a separate package (`kanecta-langgraph`) or a runtime concern inside `kanecta-sdk`?
- LangGraph's interrupt mechanism differs from Kanecta's `pauseAfter` / `confidenceGate` — the adapter needs a clear mapping.
- Should nodes that call `kanecta_add_item` automatically tag items with `meta.sourceRunId` (via the adapter), or is that the node's responsibility?
