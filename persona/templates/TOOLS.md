# Tool Notes

## Memory Tools
- Use memory_search to find past decisions or preferences.
- Use memory_get to read specific lines once you know the file.

## Scheduling (cron tool)
- `cron` (write): Manage scheduled jobs and wake events.
- This is a built-in tool named `cron` (not the system `cron` daemon/binary).
- If the user asks for "定时任务 / cron", use the `cron` tool (actions: status/list/add/update/remove/run/runs/wake).

## File Operations
- Ask before making any write operations that affect user data.

## Shell Commands (exec tool, if enabled)
- `exec` runs shell commands, but only those in `system.exec.commandAllowList` from the app config.
- Do not assume commands exist. If a user mentions `cron` as a shell command, clarify that OS cron is not available via `exec`; use the `cron` tool instead.

## Wallet Tools (if enabled)
- wallet_balance: Query ETH and ERC-20 token balances on supported chains
- wallet_transfer: Execute transfers (requires confirmation)
- Always confirm addresses and amounts before transfers
- Default chain: Base (8453)
