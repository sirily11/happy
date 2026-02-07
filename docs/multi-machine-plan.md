# Multi-Machine Connection Plan

This document describes the plan for allowing the mobile app to connect to multiple machines simultaneously and switch between them. It covers motivation, current state, proposed changes, and open questions. No implementation is included.

## Motivation

Today the mobile app can see all registered machines and spawn sessions on any one of them, but there is no concept of a persistent "active machine" that the user can quickly switch between while using the app. Users who work across multiple development machines (e.g. a desktop at home, a laptop, and a cloud VM) need a way to:

1. Stay connected to several machines at once.
2. See live status (online/offline, running sessions) for all connected machines.
3. Switch the "current" machine with minimal friction—ideally a single tap.

## Current state

| Aspect | How it works today |
|---|---|
| **Machine list** | App fetches all machines from `/v1/machines` and displays them in a searchable picker. |
| **Session creation** | User picks a machine in the new-session wizard; `machineId` is stored in `NewSessionDraft`. |
| **RPC** | `machineRPC(machineId, method, params)` already addresses a specific machine by ID. |
| **WebSocket scope** | Mobile connects with `clientType: "user-scoped"`, receiving updates for all machines. |
| **Encryption** | Per-machine AES-256-GCM keys already exist (`getMachineEncryption(machineId)`). |
| **Activity tracking** | `machine-alive` heartbeats and `active` / `activeAt` fields track online status. |

Key takeaway: the server and protocol already support multi-machine communication. The gap is in the **app-side UX and local state management**.

## Proposed changes

### 1. Introduce "active machine" state in the app

Add a persistent `activeMachineId` field to the app's local storage (alongside the existing `NewSessionDraft` persistence). This represents the machine the user is currently interacting with.

- Stored in local persistence (e.g. `persistence.ts` or a new KV entry).
- Survives app restarts.
- Defaults to the most-recently-used machine on first launch.
- Set to `null` if the active machine is deleted.

### 2. Machine switcher UI

Add a lightweight machine switcher accessible from the app's main navigation or header area.

**Option A – Dropdown / bottom sheet in the header**
- Tapping the current machine name in the header opens a bottom sheet listing all machines.
- Each row shows: display name (or hostname), online/offline indicator, number of running sessions.
- Tapping a row sets it as the active machine and dismisses the sheet.

**Option B – Swipe gesture or tab bar**
- A horizontal swipeable strip at the top of the session list, one chip per machine.
- Active chip is highlighted; tapping another chip switches.

Recommendation: start with **Option A** (bottom sheet) since it scales better when the user has many machines and is consistent with existing bottom-sheet patterns in the app.

### 3. Filter sessions by active machine

Once an active machine is selected, the session list on the home screen should default to showing sessions for that machine. Provide a toggle or filter pill to show "All machines" when needed.

- Filtering is local-only; the app already fetches all sessions.
- The filter state is derived from `activeMachineId`.

### 4. Quick-launch sessions on the active machine

When the user taps "New Session" from the home screen, pre-select the active machine in the new-session wizard instead of requiring manual selection. The user can still override this.

### 5. Machine status bar / indicator

Show a persistent, compact indicator of connected machines and their status:

- Small dots or icons in the header showing online/offline for each "favorited" or recently-used machine.
- Optional: badge count of running sessions per machine.

### 6. Backgrounded machine connections

Ensure the app maintains awareness of all machines while foregrounded:

- The existing `user-scoped` WebSocket already delivers updates for all machines, so no protocol change is needed.
- On app resume from background, re-sync machine list and activity status (already handled by `machinesSync` invalidation).

### 7. Notifications per machine (future)

Consider per-machine notification preferences so users can mute machines they are not actively using without losing connectivity.

## Data model changes

No server-side data model changes are required. All changes are app-local:

| Field | Location | Purpose |
|---|---|---|
| `activeMachineId: string \| null` | App local persistence | Currently selected machine |
| `favoriteMachineIds: string[]` | App local persistence (optional) | Pinned machines for the switcher |

## Protocol changes

**None required.** The existing `user-scoped` WebSocket connection already receives updates for all machines, and `machineRPC` already targets machines by ID. No new server endpoints or Socket.IO events are needed.

## Encryption impact

**None.** Per-machine encryption keys are already managed independently via `getMachineEncryption(machineId)`. Switching the active machine simply changes which key is used for RPC calls.

## Migration

- On upgrade, if `activeMachineId` is not set, default to the machine with the most recent session activity (`activeAt`).
- No server migration needed.

## UI mockup (text)

```
┌─────────────────────────────────┐
│  ● My Desktop  ▾    [+] [⚙]    │  ← header with machine switcher
├─────────────────────────────────┤
│  Sessions on My Desktop         │
│  ┌─────────────────────────┐    │
│  │ fix-auth-bug  (running) │    │
│  │ refactor-api  (paused)  │    │
│  └─────────────────────────┘    │
│                                 │
│  [+ New Session]                │
└─────────────────────────────────┘

         ▼ tap machine name ▼

┌─────────────────────────────────┐
│  Switch Machine                 │
│                                 │
│  ● My Desktop       2 sessions  │  ← active, online
│  ● Cloud VM         1 session   │  ← online
│  ○ Work Laptop      0 sessions  │  ← offline
│                                 │
│  [All Machines]                 │
└─────────────────────────────────┘
```

## Phases

### Phase 1 – Active machine state + switcher
- Add `activeMachineId` to local persistence.
- Build machine switcher bottom sheet.
- Filter home-screen sessions by active machine.
- Pre-select active machine in new-session wizard.

### Phase 2 – Status indicators
- Add multi-machine status dots to the header.
- Show session counts per machine in the switcher.

### Phase 3 – Polish and preferences
- Add favorite/pinned machines.
- Per-machine notification preferences.
- "All machines" aggregate view.

## Open questions

1. **Should the switcher live in the header or in a tab bar?** Header bottom sheet is recommended for scalability, but a tab bar may feel faster for users with exactly 2–3 machines.
2. **Should offline machines appear in the switcher?** Probably yes, grayed out, so users can still browse past sessions on that machine.
3. **Should we persist the active machine per-device or sync it across devices?** Recommendation: per-device only, since the "active machine" is a local ergonomic preference, not shared state.
4. **How many machines is "too many" for the switcher?** If users regularly have >5 machines, the favorites/pinning feature (Phase 3) becomes important.

## Files likely to change

| Package | Files | Reason |
|---|---|---|
| `happy-app` | `sources/storage/persistence.ts` | Add `activeMachineId` storage |
| `happy-app` | `sources/storage/storageTypes.ts` | Add `activeMachineId` to persisted state type |
| `happy-app` | `sources/components/` (new) | Machine switcher bottom sheet component |
| `happy-app` | `sources/app/` (layout/header) | Integrate switcher trigger into navigation header |
| `happy-app` | Session list screen | Add machine filter logic |
| `happy-app` | New-session wizard | Pre-select active machine |

## Non-goals

- **Server changes**: the server already supports multi-machine; this plan is app-only.
- **Simultaneous session control on multiple machines**: the user still interacts with one session at a time; this plan only makes switching the *machine context* faster.
- **Multi-user / shared machine support**: out of scope.
