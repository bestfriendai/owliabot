/**
 * Clawlet HTTP Client
 *
 * Communicates with clawlet daemon via HTTP JSON-RPC 2.0.
 * @see https://github.com/owliabot/clawlet
 */

import { createLogger } from "../utils/logger.js";
import { EventEmitter } from "node:events";

const log = createLogger("clawlet-client");

// ============================================================================
// Types
// ============================================================================

/** Balance query parameters */
export interface BalanceQuery {
  /** Wallet address (0x-prefixed) */
  address: string;
  /** Chain ID (e.g. 1 for mainnet, 8453 for Base) */
  chain_id: number;
  /** Optional: specific ERC-20 token addresses to query */
  tokens?: string[];
}

/** Single token balance */
export interface TokenBalance {
  /** Token symbol (e.g. "USDC") */
  symbol: string;
  /** Human-readable balance string */
  balance: string;
  /** Token contract address */
  address: string;
  /** Token decimals */
  decimals: number;
}

/** Balance query response */
export interface BalanceResponse {
  /** Native ETH balance as human-readable string */
  eth: string;
  /** ERC-20 token balances */
  tokens: TokenBalance[];
}

/** Transfer request parameters */
export interface TransferRequest {
  /** Recipient address (0x-prefixed) */
  to: string;
  /** Amount as decimal string (e.g. "1.0") */
  amount: string;
  /** Token to transfer — "ETH" for native, or symbol/address */
  token: string;
  /** Chain ID to execute on */
  chain_id: number;
}

/** Transfer response */
export interface TransferResponse {
  /** "success" or "denied" */
  status: "success" | "denied";
  /** Transaction hash (present on success) */
  tx_hash?: string;
  /** Audit event ID (present on success) */
  audit_id?: string;
  /** Denial reason (present on denial) */
  reason?: string;
}

/** Health check response */
export interface HealthResponse {
  status: "ok" | "error";
  version?: string;
}

/** Address query response */
export interface AddressResponse {
  /** Wallet address managed by Clawlet (0x-prefixed) */
  address: string;
}

/** Auth grant request */
export interface AuthGrantRequest {
  /** Admin password */
  password: string;
  /** Token scope: "read" or "trade" */
  scope: "read" | "trade" | "read,trade";
  /** Token TTL in hours (optional) */
  expires_hours?: number;
  /** Agent ID for audit (optional) */
  agent_id?: string;
  /** Label for the token */
  label?: string;
}

/** Auth grant response */
export interface AuthGrantResponse {
  /** The granted token (e.g., "clwt_xxx") */
  token: string;
  /** Token scope */
  scope: string;
  /** Expiration timestamp (ISO 8601) */
  expires_at?: string;
}

/** JSON-RPC 2.0 request */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id: number;
}

/** JSON-RPC 2.0 response */
interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: number;
}

/** Client configuration */
export interface ClawletClientConfig {
  /** HTTP base URL (default: http://127.0.0.1:9100) */
  baseUrl?: string;
  /** Auth token for API calls (clwt_xxx format) */
  authToken?: string;
  /** Request timeout in ms (default: 30000) */
  requestTimeout?: number;
}

/** Client error types */
export class ClawletError extends Error {
  constructor(
    message: string,
    public code:
      | "CONNECTION_FAILED"
      | "TIMEOUT"
      | "UNAUTHORIZED"
      | "RPC_ERROR"
      | "INVALID_RESPONSE",
    public details?: unknown
  ) {
    super(message);
    this.name = "ClawletError";
  }
}

// ============================================================================
// Client Implementation
// ============================================================================

const DEFAULT_BASE_URL = "http://127.0.0.1:9100";
const DEFAULT_REQUEST_TIMEOUT = 30000;

/**
 * Clawlet HTTP Client
 *
 * Example usage:
 * ```typescript
 * const client = new ClawletClient({
 *   baseUrl: "http://127.0.0.1:9100",
 *   authToken: "clwt_your-token-here"
 * });
 *
 * // Get wallet address
 * const { address } = await client.address();
 *
 * // Query balance
 * const balance = await client.balance({
 *   address: "0x...",
 *   chain_id: 8453
 * });
 * ```
 */
export class ClawletClient extends EventEmitter {
  private config: Required<Omit<ClawletClientConfig, "authToken">> & {
    authToken: string;
  };
  private requestId = 0;

  constructor(config: ClawletClientConfig = {}) {
    super();
    this.config = {
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      authToken: config.authToken ?? "",
      requestTimeout: config.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT,
    };
  }

  /**
   * Update the auth token
   */
  setAuthToken(token: string): void {
    this.config.authToken = token;
  }

  /**
   * Get the current auth token
   */
  getAuthToken(): string {
    return this.config.authToken;
  }

  /**
   * Health check — does not require auth
   */
  async health(): Promise<HealthResponse> {
    return this.call<HealthResponse>("health", undefined, false);
  }

  /**
   * Get wallet address managed by Clawlet — does not require auth
   */
  async address(): Promise<AddressResponse> {
    return this.call<AddressResponse>("address", undefined, false);
  }

  /**
   * Grant an auth token using admin password
   * Does not require existing auth token
   */
  async authGrant(req: AuthGrantRequest): Promise<AuthGrantResponse> {
    const response = await this.call<AuthGrantResponse>(
      "auth.grant",
      req,
      false
    );
    // Optionally auto-set the token
    if (response.token) {
      this.config.authToken = response.token;
    }
    return response;
  }

  /**
   * Query ETH and token balances
   * Requires: Read scope token
   */
  async balance(query: BalanceQuery): Promise<BalanceResponse> {
    this.validateAddress(query.address);
    return this.call<BalanceResponse>("balance", query);
  }

  /**
   * Execute a transfer
   * Requires: Trade scope token
   */
  async transfer(req: TransferRequest): Promise<TransferResponse> {
    this.validateAddress(req.to);
    if (!req.amount || isNaN(parseFloat(req.amount))) {
      throw new ClawletError("Invalid amount", "RPC_ERROR");
    }
    return this.call<TransferResponse>("transfer", req);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Make a JSON-RPC call over HTTP
   */
  private async call<T>(
    method: string,
    params?: unknown,
    requireAuth = true
  ): Promise<T> {
    if (requireAuth && !this.config.authToken) {
      throw new ClawletError("Auth token required", "UNAUTHORIZED");
    }

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      params,
      id: ++this.requestId,
    };

    const response = await this.sendRequest<T>(request, requireAuth);
    return response;
  }

  /**
   * Send HTTP request and parse JSON-RPC response
   */
  private async sendRequest<T>(
    request: JsonRpcRequest,
    requireAuth: boolean
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.requestTimeout);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (requireAuth && this.config.authToken) {
        headers["Authorization"] = `Bearer ${this.config.authToken}`;
      }

      log.debug(`Sending request to ${this.config.baseUrl}/rpc: ${request.method}`);

      const response = await fetch(`${this.config.baseUrl}/rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new ClawletError("Unauthorized", "UNAUTHORIZED");
        }
        throw new ClawletError(
          `HTTP error: ${response.status} ${response.statusText}`,
          "RPC_ERROR"
        );
      }

      const jsonResponse = (await response.json()) as JsonRpcResponse<T>;

      if (jsonResponse.error) {
        // Map error codes
        const code =
          jsonResponse.error.code === -32001 ? "UNAUTHORIZED" : "RPC_ERROR";

        throw new ClawletError(
          jsonResponse.error.message,
          code,
          jsonResponse.error.data
        );
      }

      if (jsonResponse.result === undefined) {
        throw new ClawletError("No result in response", "INVALID_RESPONSE");
      }

      return jsonResponse.result;
    } catch (err) {
      if (err instanceof ClawletError) {
        throw err;
      }

      if (err instanceof Error) {
        if (err.name === "AbortError") {
          throw new ClawletError(
            `Request timeout after ${this.config.requestTimeout}ms`,
            "TIMEOUT"
          );
        }

        // Network errors
        if (
          err.message.includes("ECONNREFUSED") ||
          err.message.includes("fetch failed")
        ) {
          throw new ClawletError(
            `Connection refused: ${this.config.baseUrl}`,
            "CONNECTION_FAILED"
          );
        }

        throw new ClawletError(
          `Request failed: ${err.message}`,
          "CONNECTION_FAILED",
          err
        );
      }

      throw new ClawletError(
        `Unknown error: ${String(err)}`,
        "CONNECTION_FAILED"
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Validate Ethereum address format
   */
  private validateAddress(address: string): void {
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new ClawletError(
        `Invalid address format: ${address}`,
        "RPC_ERROR"
      );
    }
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let globalClient: ClawletClient | null = null;

/**
 * Get or create the global ClawletClient instance
 */
export function getClawletClient(config?: ClawletClientConfig): ClawletClient {
  if (!globalClient) {
    globalClient = new ClawletClient(config);
  } else if (config) {
    // Update config if provided
    if (config.authToken) {
      globalClient.setAuthToken(config.authToken);
    }
  }
  return globalClient;
}

/**
 * Reset the global client (for testing)
 */
export function resetClawletClient(): void {
  globalClient = null;
}
