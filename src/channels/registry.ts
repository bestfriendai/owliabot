import type { ChannelPlugin, ChannelId } from "./interface.js";

export class ChannelRegistry {
  private plugins = new Map<ChannelId, ChannelPlugin>();

  register(plugin: ChannelPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  get(id: ChannelId): ChannelPlugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): ChannelPlugin[] {
    return Array.from(this.plugins.values());
  }

  async startAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.start();
    }
  }

  async stopAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.stop();
    }
  }
}
