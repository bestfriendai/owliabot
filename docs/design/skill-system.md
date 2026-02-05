# Skill 系统设计

> 状态：草案 (Draft)  
> 作者：Lay2  
> 日期：2026-02-05

## 1. 概述

Skill 是 OwliaBot 的可扩展能力单元，允许用户通过 JavaScript/TypeScript 脚本扩展 bot 的功能。本文档定义 skill 的执行模型及其与安全层（WriteGate、TierPolicy）的集成方式。

### 设计原则

1. **安全边界在工具层，不在 skill 层** — Skill 是透明的"调用者"，不绕过任何门控
2. **Skill 作者无需重新实现安全逻辑** — 底层工具自带安全检查
3. **用户体验一致** — 无论直接调用还是通过 skill 调用，敏感操作的确认流程相同
4. **可审计** — 所有 skill 触发的工具调用都记录到 audit log

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                         Agent Loop                               │
│                   (LLM 决定调用哪个 skill)                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Skill Executor                              │
│                   skill.execute(params)                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Tool Router                                │
│                  识别 skill 要调用哪个工具                         │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┬───────────────┐
          ▼               ▼               ▼               ▼
     ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐
     │  Read   │    │  Write   │    │ System   │    │  Signer   │
     │  Tools  │    │  Tools   │    │Capability│    │  链上操作  │
     └────┬────┘    └────┬─────┘    └────┬─────┘    └─────┬─────┘
          │              │               │                │
          ▼              ▼               ▼                ▼
     ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐
     │  直接   │    │WriteGate │    │ Allowlist│    │TierPolicy │
     │  执行   │    │ .check() │    │ + Audit  │    │.evaluate()│
     └────┬────┘    └────┬─────┘    └────┬─────┘    └─────┬─────┘
          │              │               │                │
          │         ┌────┴────┐          │          ┌─────┴─────┐
          │         ▼         ▼          │          ▼           ▼
          │    Allowlist  Confirm?       │     Tier 2/3    Tier 1
          │    Check      (如需)         │     自动/inline  Companion
          │         │         │          │          │       App
          │         ▼         ▼          │          │         │
          └─────────┴─────────┴──────────┴──────────┴─────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   Audit Log     │
                    │ (JSONL, ULID)   │
                    └─────────────────┘
```

## 3. 工具分类与安全层映射

| 工具类型 | 示例 | 安全层 | 检查内容 |
|---------|------|--------|---------|
| **Read Tools** | read-file, list-dir, read-url | 无 | 直接执行 |
| **Write Tools** | edit-file, write-file, delete-file | WriteGate | allowlist + 可选确认 |
| **System Capability** | web.fetch, web.search, exec | SystemCapability | 域名/命令白名单 + 私网拦截 |
| **Signer/链上** | transfer, approve, sign | TierPolicy | Tier 1/2/3 分级确认 |

### 3.1 WriteGate 集成

当 skill 调用写工具时：

```typescript
// src/skills/executor.ts
async function executeSkillToolCall(skill: Skill, toolCall: ToolCall, context: Context) {
  const tool = resolveTool(toolCall.name);
  
  if (tool.category === 'write') {
    // 走 WriteGate 检查
    const gateResult = await writeGate.check({
      tool: toolCall,
      userId: context.userId,
      sessionId: context.sessionId,
      channel: context.channel,  // 用于发确认消息
    });
    
    if (gateResult.action === 'deny') {
      return { success: false, error: gateResult.reason };
    }
    
    if (gateResult.action === 'confirm') {
      const confirmed = await gateResult.awaitConfirmation();
      if (!confirmed) {
        return { success: false, error: 'User rejected' };
      }
    }
  }
  
  // 执行工具
  return tool.execute(toolCall.arguments, context);
}
```

### 3.2 TierPolicy 集成

当 skill 调用链上操作时：

```typescript
// src/skills/executor.ts
async function executeSkillSignerCall(skill: Skill, call: SignerCall, context: Context) {
  // 评估策略
  const decision = tierPolicy.evaluate({
    tool: call.operation,
    params: call.params,
    amountUsd: call.estimatedValueUsd,
    userId: context.userId,
  });
  
  switch (decision.action) {
    case 'allow':
      // Tier 3: 自动执行
      return executeSigner(call, decision.signerTier, context);
      
    case 'confirm':
      // Tier 2: inline 确认
      const confirmed = await requestInlineConfirmation(call, context);
      if (!confirmed) return { success: false, error: 'User rejected' };
      return executeSigner(call, decision.signerTier, context);
      
    case 'escalate':
      // Tier 1: Companion App
      return requestCompanionAppApproval(call, context);
      
    case 'deny':
      return { success: false, error: decision.reason };
  }
}
```

## 4. Skill 定义格式

```typescript
// types/skill.ts
interface SkillDefinition {
  id: string;                    // 唯一标识，如 "weather"
  name: string;                  // 显示名称
  description: string;           // 描述（给 LLM 看）
  version: string;               // 语义化版本
  
  // 权限声明（用于 UI 展示和审计）
  permissions: {
    tools?: string[];            // 需要的工具，如 ["web.fetch", "read-file"]
    signer?: boolean;            // 是否需要签名能力
    network?: boolean;           // 是否需要网络访问
  };
  
  // 入口函数
  execute: (params: unknown, context: SkillContext) => Promise<SkillResult>;
}

interface SkillContext {
  // 工具调用（自动走安全检查）
  callTool: (name: string, args: unknown) => Promise<ToolResult>;
  
  // 链上操作（自动走 TierPolicy）
  callSigner: (operation: string, params: unknown) => Promise<SignerResult>;
  
  // 用户交互
  sendMessage: (text: string) => Promise<void>;
  askConfirmation: (prompt: string) => Promise<boolean>;
  
  // 上下文
  userId: string;
  sessionId: string;
  workspace: string;
}
```

## 5. Skill 示例

### 5.1 天气查询（只读）

```typescript
// skills/weather/index.ts
export const weatherSkill: SkillDefinition = {
  id: 'weather',
  name: '天气查询',
  description: '获取指定城市的天气信息',
  version: '1.0.0',
  permissions: {
    tools: ['web.fetch'],
    network: true,
  },
  
  async execute(params: { city: string }, ctx) {
    const url = `https://wttr.in/${encodeURIComponent(params.city)}?format=j1`;
    const result = await ctx.callTool('web.fetch', { url });
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    const data = JSON.parse(result.data.content);
    return {
      success: true,
      data: {
        city: params.city,
        temperature: data.current_condition[0].temp_C,
        description: data.current_condition[0].weatherDesc[0].value,
      },
    };
  },
};
```

### 5.2 文件编辑（需要 WriteGate）

```typescript
// skills/todo/index.ts
export const todoSkill: SkillDefinition = {
  id: 'todo',
  name: 'Todo 管理',
  description: '管理 workspace 中的 todo.md 文件',
  version: '1.0.0',
  permissions: {
    tools: ['read-file', 'edit-file'],  // 声明需要写权限
  },
  
  async execute(params: { action: 'add' | 'list'; item?: string }, ctx) {
    const todoPath = `${ctx.workspace}/todo.md`;
    
    if (params.action === 'list') {
      const result = await ctx.callTool('read-file', { path: todoPath });
      return result;
    }
    
    if (params.action === 'add' && params.item) {
      // 这里会自动触发 WriteGate 检查
      // 用户会看到确认消息："要编辑 todo.md 吗？"
      const result = await ctx.callTool('edit-file', {
        path: todoPath,
        operation: 'append',
        content: `- [ ] ${params.item}\n`,
      });
      return result;
    }
    
    return { success: false, error: 'Invalid action' };
  },
};
```

### 5.3 链上转账（需要 TierPolicy）

```typescript
// skills/transfer/index.ts
export const transferSkill: SkillDefinition = {
  id: 'transfer',
  name: 'Token 转账',
  description: '发送 ERC20 代币',
  version: '1.0.0',
  permissions: {
    signer: true,  // 声明需要签名能力
    network: true,
  },
  
  async execute(params: { token: string; to: string; amount: string }, ctx) {
    // 这里会自动触发 TierPolicy 评估
    // 根据金额决定 Tier 2 (inline 确认) 或 Tier 1 (Companion App)
    const result = await ctx.callSigner('transfer', {
      token: params.token,
      to: params.to,
      amount: params.amount,
    });
    
    return result;
  },
};
```

## 6. 审计日志

所有 skill 触发的工具调用都记录到 `workspace/audit.jsonl`：

```json
{
  "id": "01HQ3K...",
  "ts": 1707091234567,
  "skillId": "todo",
  "skillVersion": "1.0.0",
  "tool": "edit-file",
  "params": { "path": "todo.md", "operation": "append" },
  "userId": "123456",
  "sessionId": "session-abc",
  "gate": "WriteGate",
  "gateResult": "approved",
  "result": "success"
}
```

## 7. 安全考量

### 7.1 Skill 不能绕过安全层

- Skill 只能通过 `ctx.callTool()` 和 `ctx.callSigner()` 调用工具
- 这些方法内部强制走 WriteGate / TierPolicy
- Skill 代码无法直接访问底层 API

### 7.2 权限声明是提示，不是强制

- `permissions` 字段用于 UI 展示和用户信任判断
- 实际权限检查在工具层，不依赖 skill 的自我声明
- 即使 skill 声明了 `tools: ['read-file']`，它仍可调用 `edit-file`，但会被 WriteGate 拦截

### 7.3 Skill 沙箱（未来）

未来可考虑：
- V8 Isolate 隔离
- 资源限制（CPU、内存、执行时间）
- 网络白名单

## 8. 实现计划

| 阶段 | 内容 | 状态 |
|-----|------|------|
| Phase 1 | Skill 定义格式 + loader | 🔜 |
| Phase 2 | Tool Router + WriteGate 集成 | 🔜 |
| Phase 3 | TierPolicy 集成 | 🔜 |
| Phase 4 | 内置 skill（weather、todo） | 🔜 |
| Phase 5 | 用户自定义 skill 加载 | 🔜 |

## 9. 参考

- [WriteGate 设计](./write-gate.md)
- [Tier Policy 设计](./tier-policy.md)
- [审计日志策略](./audit-strategy.md)
