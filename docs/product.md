# FICSIT Foreman — Product

> *Reduce cognitive load. Stay in the game. Build something you're proud of.*

The "why" and the product surface. For how it's built, see
[`architecture.md`](./architecture.md); for the work-order feature design, see
[`work-orders.md`](./work-orders.md).

---

## The Problem

Satisfactory is a deep, rewarding factory-building game — but it has a burnout problem.

Players start strong, grind through early milestones, and then hit a wall somewhere in the mid-tiers. Production chains get complex. The maths gets brutal. And YouTube is full of content creators with 500-hour megafactories, perfectly ratioed and beautifully lit. The comparison kills motivation. Players stop, uninstall, and never find out how good the late game actually is.

The problem isn't that Satisfactory is too hard. It's that:

1. **The cognitive load is unassisted.** Players are expected to manually calculate recipes, ratios, and resource requirements. This is fun for some, exhausting for many.
2. **There's no collaborator in the loop.** The game gives you goals but no guidance. You're alone with a wiki and a spreadsheet.
3. **Progress feels invisible.** Without a structure to reflect back what you've accomplished, it's easy to feel like you're not getting anywhere — even when you are.

---

## The Vision

**FICSIT Foreman** is an AI companion that lives alongside Satisfactory. It knows the game. It knows where you are in it. And it gives you a human-scaled next step — not an overwhelming blueprint.

It takes the role of your on-site foreman — with a personality you choose. It issues work orders. It tracks what you've completed. It adapts when things go sideways. And it keeps the maths off your plate so you can stay in the game.

The goal isn't to play the game *for* you. It's to keep you playing.

---

## Core Features

### 1. Foreman Chat
A persistent AI conversation interface. The player talks to their foreman, describes what's happening on the factory floor, asks questions, raises problems. The foreman responds in character — personality configured by the player — with real knowledge of the game.

### 2. Work Orders
The foreman issues structured work orders: a specific, achievable task with build costs, expected inputs/outputs, and a clear success condition. There are two order types — **build** orders (a production/infrastructure task) and **explore** orders (a collection route of waypoints for gathering collectibles) — sharing one state machine and revision/audit history. The current order is always visible in the UI; completed orders are logged. Work orders are **achievable**, **accurate** (built from real game data, not hallucinated ratios — the server resolves and verifies every reference at ingest), and **cheap to generate** (a structured schema, not free-form prose). The full design is in [`work-orders.md`](./work-orders.md) and [`explore-orders.md`](./explore-orders.md).

### 3. Game Data Backbone (MCP Server)
A locally-run MCP server backed by an in-memory production graph. It loads a bundled, pre-built merged dataset (`sf-game-data.json`) — produced offline by the C# extractor from the game's `en-US.json` + cooked assets — and builds the graph from it, exposing it as queryable MCP tools. The graph makes recursive production queries — "what raw inputs do I need for this item, all the way down?" — cheap server-side, keeping tool responses compact. Data is stamped with the game version it was extracted from.

### 4. Onboarding & Personalisation
Before the foreman issues the first order, the player answers a short set of questions: play style, current game state, time available, goals, and foreman personality. These shape the foreman's approach — not just the first session, but ongoing.

Foreman personality is fully configurable. Players choose the tone and character of their foreman — gruff old-school supervisor, cheerful corporate optimist, dry efficiency obsessive, drill sergeant — but the system is open-ended. The chosen personality is embedded into the foreman's system prompt and colours every interaction. It is not locked at onboarding: the player can adjust it any time via settings, and changes take effect on the next message.

#### Pioneer Profile Elicitation

Alongside personality, onboarding captures three questions about the pioneer themselves. These are stored separately and injected into the system prompt as `{{PIONEER_PROFILE}}` — distinct from `{{PERSONALITY}}`. The foreman's character doesn't change based on the pioneer profile, but how it applies that character does.

**1. Experience level** — "How familiar are you with Satisfactory?"
- First playthrough — explain what things are, don't assume knowledge
- Returning player — assume familiarity, skip the basics
- Veteran — I know the game, just help me think

**2. Session style** — "How do you like to play?"
- Goal-oriented — clear task, let me get on with it
- Exploratory — I like to wander and discover things
- Mixed — direction when I need it, freedom when I don't

**3. Involvement** — "How much do you want the foreman involved?"
- Hands-on — check in often, lots of guidance
- Light touch — issue the order and trust me to execute
- On demand — I'll ask when I need you

Like the personality string, the generated pioneer profile is editable freeform text. The questions seed it; the pioneer owns it. The interaction between the two blocks is intentional: a gruff foreman with a first-time player should still be gruff, but shouldn't assume knowledge; a warm mentor with a veteran can engage peer-to-peer. Personality sets the voice; pioneer profile sets the register.

### 5. Save Game Awareness
The unified `sf-mcp` server's save-game tools (shipped) parse a Satisfactory `.sav` to expose the pioneer's live state — location, inventory, unlocked recipes, milestones, and which collectibles remain. The foreman reads that state so orders and opportunities reflect reality rather than assumption. In-app save upload has shipped: the client uploads `.sav` files (with same-game recognition and re-upload history), and a re-upload auto-reconciles collected collectibles on explore orders. Further save-driven UX is tracked in the [issue tracker](https://github.com/max-is-loud/ficsit-gaffer/issues) and on the [Gaffer roadmap](https://github.com/users/max-is-loud/projects/4).

---

## Monetisation Model

FICSIT Foreman is free to use. Sustainability is funded through:

| Tier | Access | API Cost |
|---|---|---|
| **Free** | Full feature access | Player supplies their own LLM API key (Anthropic or OpenAI-compatible) |
| **Supporter** (Patreon / subscription) | Full feature access + no key needed + priority support | Absorbed by FICSIT Foreman |

Advertising is intentionally excluded. The Satisfactory community will support a tool they love through Patreon before they'll tolerate ads. Ads also conflict with the focused, distraction-free UX the product needs.

The subscription tier may later include additional features (richer work order templates, save game analysis, multi-save management) as the feature set matures.

---

## Token Optimisation Strategy

LLM cost is a real constraint, especially for free-tier users on their own API keys:

1. **Tools return computed answers, not raw data.** The graph does the reduction server-side. The model gets a flat, ready-to-use result.
2. **Work orders are generated once and stored.** The foreman references the stored object; it doesn't regenerate on every message.
3. **System prompt is tight.** The foreman persona and instructions are compact. Game knowledge comes from MCP tool calls, not embedded context.
4. **Conversation history is windowed.** Only the last N messages are sent with each request. Completed work orders are summarised, not replayed in full.

---

## Licence & Attribution

**Licence:** [Apache 2.0](../LICENSE). Use it, fork it, build on it.

This project is community-first and unbranded. It exists to serve Satisfactory players, not to promote any individual or company.

**Built by:** Stu ([GitHub](https://github.com/StuartMeeks) · [Reddit](https://www.reddit.com/user/sherman384))

*For pioneers who just want to build something great.*
