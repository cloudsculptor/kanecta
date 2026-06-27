# Everything is an Item

## The insight

The spec already says types are first-class items (`type: "type"`, with their own `metadata.json`). The logical conclusion is to take that all the way — merge every authoritative folder into `data/`, make every concept a typed item, and let SQLite index it all.

---

## Merging types into data/

Types currently live in `.kanecta/types/` serving double duty: type definitions AND a type-to-items index cache. The type definitions are authoritative; the index cache is derived.

If types move into `data/`:
- They're found by `metadata.json` where `type === "type"` — same as any other item
- The `type.json` and `function.json` payload files sit alongside `metadata.json` in the item folder, unchanged
- The `items.json` reverse index disappears — SQLite answers `SELECT id FROM items WHERE type_id = ?`
- Types participate in the tree naturally — annotations, history, relationships, aliasing all work for free

---

## Merging all authoritative folders into data/

The spec identifies these as authoritative: `data/`, `history/`, `annotations/`, `aliases/`, `remotes/`, `fields/`, `config/`.

Each can become items:

| Folder | As an item |
|---|---|
| `aliases/` | `type: "alias"`, `value` = target UUID. Multiple aliases to same item = multiple alias items |
| `annotations/` | `type: "annotation"`, living under their target in an `"annotations"` aspect. `parentAnnotationId` becomes a normal `parentId` — threaded discussions are just the tree |
| `history/` | `type: "history"`, living under their parent item in a `"history"` aspect. Each snapshot is a child of the item it records |
| `remotes/` | Already items. `cachedAt` and `subscriptionSource` on `metadata.json` distinguish them from local items |
| `fields/` | `type: "field-ref"`, storing `itemId` and `fieldXId`. Reverse index becomes a SQLite query |
| `config/` | A single item at a well-known alias, `type: "config"`. Owner and specVersion are just fields. Config changes get history for free |

**The result:**

```
.kanecta/
  data/     ← everything
```

One folder. Everything is an item. SQLite indexes it all.

---

## One reusable UI

With everything as a first-class item, you build one good item list component and reuse it everywhere:

- History? Items filtered by aspect `"history"`
- Annotations? Items in the `"annotations"` aspect
- Aliases? Items of `type: "alias"`
- Relationships? Items of `type: "relationship"`
- Types? Items of `type: "type"`

Every improvement to the core item UI — better search, better rendering, better keyboard nav — automatically improves every concept in the system simultaneously. Users learn one mental model and it works everywhere.

**Bonus behaviours that emerge for free:**
- Annotations on annotations — threaded discussions are just the tree
- History items can be annotated — "why did this change?" as a comment on a snapshot
- Everything is searchable uniformly
- AI tools get one interface to the whole datastore — no special cases

---

## Prior art

### Smalltalk (Xerox PARC, 1970s)

Created by Alan Kay. The original "everything is an object" system. In Smalltalk there are no primitives — the number `5` is an object, `true` is an object, a class is an object, a method is an object. Everything responds to messages, everything plays by the same rules.

Smalltalk invented or pioneered: object-oriented programming, the GUI (windows, icons, mouse-driven desktop), live-editable IDEs, bytecode/virtual machines, garbage collection. The Macintosh and Windows both trace directly to what Xerox PARC built in Smalltalk.

Kay's actual insight — which he felt Java and C++ missed entirely — was that a system built from one kind of thing with consistent rules is easier to understand, extend, and reason about than a system with many special cases. He called it "late binding" — nothing is hardwired, the system stays flexible.

**The parallel to Kanecta:** same principle. One kind of thing (item), consistent rules, no special cases.

### RDF (W3C, late 1990s)

Resource Description Framework. Reduces all knowledge to three-part statements (triples):

```
subject → predicate → object

Richard → knows → Alan
Richard → livesIn → Featherston
Featherston → isIn → NewZealand
```

Every thing — including predicates — is identified by a URI, so anyone can define new predicates without collisions.

**Reification** — RDF's answer to first-class relationships. You can make statements *about* statements:

```
[Richard knows Alan] → wasAssertedBy → Wikipedia
[Richard knows Alan] → confidence → 0.8
```

A relationship becomes a thing you can describe. Exactly what Kanecta arrives at independently — relationships as first-class items that can be annotated, related, and queried.

RDF never took over the world: the XML syntax was hideous, reification was verbose in practice, and SPARQL was hard. **Property graphs** (Neo4j's model) took the same intuition and made it practical — edges have properties directly rather than requiring reification.

**The parallel to Kanecta:** same ambition as RDF, same property-graph pragmatism as Neo4j, without the baggage of either. Items as subjects, relationships as first-class predicates with properties, aspects as dimensions of the same thing.

---

## Summary

Kanecta has independently arrived at a place that Smalltalk, RDF, and property graph databases all approached from different angles: **one kind of thing, consistent rules, no special cases**. The payoff is a simpler storage model, a simpler query model, a simpler UI, and a system that gets more powerful as it grows rather than more complicated.
