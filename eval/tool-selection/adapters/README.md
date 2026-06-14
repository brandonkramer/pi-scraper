# tool-selection adapters

A model adapter is a Unix filter: read the eval JSON on **stdin**
(`{instructions, tools, fixtures}`), write prediction JSON on **stdout**
(`{predictions:[{id, actualTool, actualArgs}]}`). The runner scores
*predictions*, so providers swap here without touching scoring.

The runner shells out to whatever `PI_TOOL_SELECTION_EVAL_COMMAND` points at:

```bash
PI_TOOL_SELECTION_EVAL_COMMAND='node eval/tool-selection/adapters/pi.mjs' \
  node eval/tool-selection/run.mjs
```

## `pi.mjs`

Backed by the local `pi` CLI (`--no-tools`, text mode, one call per suite).

| Env | Effect |
| --- | --- |
| `PI_TOOL_SELECTION_PI_BIN` | pi binary (default `pi`) |
| `PI_TOOL_SELECTION_PI_PROVIDER` | `--provider` passthrough |
| `PI_TOOL_SELECTION_PI_MODEL` | `--model` passthrough |
| `PI_TOOL_SELECTION_NO_CUES` | drop routing cues from the prompt (measure contract alone) |

## Add a provider

Copy the stdin→stdout contract: parse the input envelope, build a prompt,
call your model, and emit the prediction envelope. Loose-JSON/fenced output is
tolerated by the runner's envelope parsing. Point
`PI_TOOL_SELECTION_EVAL_COMMAND` at your new adapter. When a second adapter
shares the envelope/loose-JSON parsing, lift that into `eval/_lib/` (not before —
abstract on the second consumer).
