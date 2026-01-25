export interface WorkspaceFiles {
  soul?: string;
  identity?: string;
  user?: string;
  heartbeat?: string;
  memory?: string;
  tools?: string;
}

export interface WorkspaceLoader {
  load(): Promise<WorkspaceFiles>;
  getFile(name: string): Promise<string | undefined>;
}
