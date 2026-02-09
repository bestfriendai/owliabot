# Task: Implement P1 + P2 Telegram Group Chat Features

You are working on the owliabot project (`feat/telegram-group-chat` branch). P0 is already done and committed. Now implement P1 and P2 features.

## Already Done (P0) — DO NOT REWRITE
- `src/gateway/group-history.ts` — GroupHistoryBuffer (ring buffer)
- `src/gateway/server.ts` — effectiveBody construction (sender labels, reply-to, history injection)
- `src/channels/interface.ts` — `replyToBody`, `replyToSender` on MsgContext
- `src/channels/telegram/index.ts` — reply_to_message extraction
- `src/gateway/activation.ts` — `passesUserAllowlist()` helper
- `src/config/schema.ts` — `group.historyLimit`

## P1 Features to Implement

### Feature 4: Per-group Configuration
**Current**: `groupAllowList` is just a string array; `group.activation` is global.
**Target**: Support per-group config in `telegramConfigSchema`:

```yaml
telegram:
  groups:
    "-1001234567890":
      enabled: true
      requireMention: false
      allowFrom: ["123456", "@alice"]
      historyLimit: 100
    "*":   # default for all groups
      requireMention: true
```

**Changes needed**:
1. `src/config/schema.ts`: Add `groups` field to `telegramConfigSchema` with per-group schema (enabled, requireMention, allowFrom, historyLimit). Keep backward compat with existing `groupAllowList`.
2. `src/gateway/activation.ts`: Refactor `shouldHandleMessage()` to first check per-group config, then fall back to global `group.activation`. The per-group `allowFrom` should filter by user ID or @username. `requireMention: false` means always respond in that group.
3. `src/gateway/server.ts`: When building group history, use per-group `historyLimit` if set, falling back to global `group.historyLimit`.

### Feature 5: Forum Topic Support
**Current**: All topics in a forum group share one session.
**Target**: When `message_thread_id` exists, session key gets a topic suffix.

**Changes needed**:
1. `src/channels/interface.ts`: Add `threadId?: string` to MsgContext.
2. `src/channels/telegram/index.ts`: Extract `message_thread_id` from the Telegram update, set as `threadId`.
3. `src/agent/session-key.ts` (or wherever `resolveSessionKey`/`resolveConversationId` is): When `ctx.threadId` is present, append `:topic:<threadId>` to the session key.

### Feature 6: Mention Patterns (custom trigger words)
**Current**: Only detects @username mention.
**Target**: Support custom regex patterns:

```yaml
group:
  mentionPatterns: ["@owlia", "owlia", "猫头鹰"]
```

**Changes needed**:
1. `src/config/schema.ts`: Add `mentionPatterns: z.array(z.string()).optional()` to groupSchema.
2. `src/gateway/activation.ts`: In the mention detection logic, also check `ctx.body` against each mentionPattern (case-insensitive). If any matches, set `mentioned = true`.

## P2 Features to Implement

### Feature 7: Per-group Sender Allowlist
Already partially handled by P1's `allowFrom`. Make sure:
- If `allowFrom` is set for a group, only those users can trigger the bot AND only their messages go into history buffer.
- If not set, all users in the group can interact.

### Feature 8: Ack Reaction
**Target**: When bot receives a mention in a group, immediately react with 👀, then after responding, change to ✅.

**Changes needed**:
1. `src/channels/interface.ts`: Add optional methods to `ChannelPlugin` interface: `addReaction(chatId, messageId, emoji)` and `removeReaction(chatId, messageId, emoji)`.
2. `src/channels/telegram/index.ts`: Implement using grammy's `ctx.api.setMessageReaction()`.
3. `src/gateway/server.ts`: In `handleMessage()`, when processing a group mention, call `addReaction(ctx.chatId, ctx.messageId, "👀")` at start, and `addReaction(ctx.chatId, ctx.messageId, "✅")` after response (remove 👀 first).

### Feature 9: Group Rate Limiting
**Target**: Prevent API overload from multiple simultaneous mentions in a group.

**Changes needed**:
1. Create `src/gateway/group-rate-limit.ts`: Simple per-session-key rate limiter (e.g., max N concurrent requests per group, with configurable limit).
2. `src/config/schema.ts`: Add `group.maxConcurrent: number` (default 3).
3. `src/gateway/server.ts`: Before processing a group mention, check rate limit. If exceeded, reply with a short message ("I'm busy, please wait...") or queue it.

## Testing Requirements
- Add/update tests for ALL new features
- Run `npm run typecheck` — must pass with zero errors
- Run `npm test` — all tests must pass (there is 1 pre-existing failure in `src/system/__tests__/exec.test.ts` due to sandbox EPERM — ignore that one)

## Constraints
- Do NOT break existing functionality or P0 features
- Do NOT modify files unrelated to these features
- Follow existing code style (TypeScript, ESM, tslog, zod)
- All new config fields MUST have sensible defaults (backward compatible)
- Keep `groupAllowList` working for backward compat (deprecate but don't remove)

## When Done
Run these commands:
```bash
npm run typecheck
npm test
openclaw gateway wake --text "Done: P1+P2 Telegram group features implemented" --mode now
```
