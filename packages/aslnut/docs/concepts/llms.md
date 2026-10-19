# For LLMs

> Draft under discussion. Interface and structure only.

**In one line:** aslnut describes itself so an AI assistant can use it correctly: `w.describe()` lists what's in a world and what can change, JSON schemas define every element's props, `llms.txt` summarises the library, a command line and an MCP server let an assistant drive it, and every error says how to fix it.

## Why

- **People build twins with assistants.** An assistant that guesses props writes broken code.
- **The same descriptions help people:** studios draw forms from schemas; errors help everyone.
- **Agents can operate a twin:** "show flooded roads after 2 hours of rain" becomes calls an assistant can make.

## The rules

1. **`w.describe()`** returns the world as data: bodies, elements, their props and current values, providers, extension points, status.
2. **JSON schemas** for every element, shape, source and option; generated from the same declarations as the types.
3. **`llms.txt`** at the docs root: the [authoring guide](../authoring.md), complete recipes, every import and an index of every part that exists, generated so it never drifts (and later the schemas).
4. **A command line** (`aslnut describe`, `aslnut check`, `aslnut compile`, `aslnut convert`) and an **MCP server** (tools: describe, add, set, fly, capture, query) let an assistant act.
5. **Errors say the fix:** a code, what went wrong, and the exact change to make.
6. **Stable names:** dotted ids (`earth.buildings`, `vehicle.car`) never change meaning between versions.

```tree
llms/
├── describe
├── schemas/
│   ├── elements
│   ├── shapes
│   ├── sources
│   └── options
├── llms.txt
├── cli/
│   ├── describe
│   ├── check
│   ├── compile
│   └── convert
├── mcp/
│   ├── describe
│   ├── add
│   ├── set
│   ├── fly
│   ├── capture
│   └── query
└── errors
```

Plain meanings: **MCP** (Model Context Protocol) = a standard way for an AI assistant to call a program's tools; **JSON schema** = a file that says which fields an object has, their types and defaults.

## Examples

```ts
// 1 · what's here, as data
w.describe();
// { bodies: ['earth'], elements: [{ id: 'suburbs', kind: 'area', props: { color: { type: 'color | fn', value: 'fn' } … } }], … }

// 2 · one element's schema
import { schema } from 'aslnut';
schema('area');   // { type: 'object', properties: { data: …, color: …, when: … }, required: ['data'] }
```

```text
// 3 · an error that says the fix
AslnutError E-PROP-012: area 'suburbs' has 'colour'; did you mean 'color'?
  fix: area({ id: 'suburbs', color: … })
```

```text
// 4 · an assistant through MCP
→ aslnut.add({ kind: 'area', id: 'flooded', data: 'field:flood>0.3', color: '#06f' })
→ aslnut.fly({ to: 'flooded', pad: .2 })
→ aslnut.capture({ size: [1280, 720] })
```

## How it relates

- **[Extending](extending.md):** every extension declares its surface, so `describe` lists it.
- **[Hosting](hosting.md):** `describe` and schemas work on a server.
- **[Tools](../reference/tools.md):** the command line and MCP server.

## Common mistakes

- **Writing props from memory.** Read the schema or `describe()`.
- **Errors as plain strings.** Every aslnut error has a code and a fix.

## Status

| part | status |
|---|---|
| typed errors with codes and the fix | [built] (`AslnutError`: code, message, where, fix) |
| `llms.txt` | [built] (the [authoring guide](../authoring.md), the six recipes checked on WebGPU and WebGL2, every import and an index of every part that exists, made from the docs and the tree by `_tree/llms.mjs`) |
| `describe`, schemas | [planned] |
| command line, MCP server | [planned] |
