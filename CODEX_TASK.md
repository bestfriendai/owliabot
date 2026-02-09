# Task: Implement Telegram Group Chat Support (P0)

You are working on the owliabot project. Implement the following 3 P0 features for Telegram group chat support.

## Context
- This is a TypeScript/Node.js project using grammy for Telegram
- Key files: `src/channels/telegram/index.ts`, `src/gateway/activation.ts`, `src/gateway/server.ts`, `src/agent/session-key.ts`, `src/channels/interface.ts`, `src/config/schema.ts`
- The bot already has basic group mention detection (reply-to-bot, @username, /command@bot)
- Session keys for groups use `agent:<agentId>:telegram:conv:<groupId>`

## Feature 1: Group History Buffer
**Problem**: When bot is NOT mentioned, messages are silently dropped. When bot IS mentioned, it has no context of the prior conversation.

**Solution**: Create `src/gateway/group-history.ts`:
```typescript
export class GroupHistoryBuffer {
  private buffers: Map<string, Array<{sender: string; body: string; timestamp: number; messageId?: string}>>;
  private limit: number;
  
  constructor(limit = 50) { ... }
  record(groupKey: string, entry: {...}): void { ... }
  getHistory(groupKey: string): Array<{...}> { ... }
  clear(groupKey: string): void { ... }
}
```

Integration in `server.ts` `handleMessage()`:
- When `shouldHandleMessage()` returns false for a group message, still record it in the buffer
- When processing a mentioned group message, inject history as context before the user message
- Format: `[Recent group messages (context)]\nAlice: message1\nBob: message2\n[End context]`

Config: Add `group.historyLimit: number` (default 50) to `configSchema`

## Feature 2: Sender Label Injection
**Problem**: In groups, LLM doesn't know who's talking.

**Solution**: In `handleMessage()`, when `chatType === "group"`, prepend sender info to the user message:
```
[Telegram group "Group Name" | Alice (@alice123)]
帮我查下 ETH 价格
```

Use `ctx.senderName`, `ctx.senderUsername`, `ctx.groupName` from MsgContext.

## Feature 3: Reply-to Context
**Problem**: When someone replies to another message and mentions the bot, the replied-to content is lost.

**Solution**: In `src/channels/telegram/index.ts`, extract `reply_to_message` content:
- Add to MsgContext interface: `replyToBody?: string`, `replyToSender?: string`
- In the telegram handler, populate these from `ctx.message.reply_to_message`
- In `handleMessage()`, append reply context to body:
```
[Replying to Bob]
现在行情怎么样
[/Replying]

@owlia 帮忙分析下
```

## Tests
- Add tests for GroupHistoryBuffer in `src/gateway/__tests__/group-history.test.ts`
- Add/update tests for activation.ts changes
- Add tests for reply-to context in telegram plugin tests
- Run `npm run typecheck` and `npm test` to make sure everything passes

## Constraints
- Do NOT break existing functionality
- Follow existing code style (TypeScript, ESM, tslog logger, zod for config)
- All new config fields must have sensible defaults (backward compatible)
- Run `npm run typecheck` and `npm test` before finishing

When completely finished, run this command to notify me:
openclaw gateway wake --text "Done: Telegram group chat P0 features implemented" --mode now
