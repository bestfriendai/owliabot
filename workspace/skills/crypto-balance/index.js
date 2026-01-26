// workspace/skills/crypto-balance/index.js

const RPC_URLS = {
  ethereum: "https://eth-mainnet.g.alchemy.com/v2/",
  polygon: "https://polygon-mainnet.g.alchemy.com/v2/",
  arbitrum: "https://arb-mainnet.g.alchemy.com/v2/",
  base: "https://base-mainnet.g.alchemy.com/v2/",
};

const NATIVE_SYMBOLS = {
  ethereum: "ETH",
  polygon: "MATIC",
  arbitrum: "ETH",
  base: "ETH",
};

export const tools = {
  get_balance: async ({ address, chain }, context) => {
    // Validate chain
    if (!RPC_URLS[chain]) {
      return {
        success: false,
        error: `Unsupported chain: ${chain}. Supported: ${Object.keys(RPC_URLS).join(", ")}`,
      };
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return {
        success: false,
        error: `Invalid address format: ${address}. Expected 0x followed by 40 hex characters.`,
      };
    }

    // Check for API key
    const apiKey = context.env.ALCHEMY_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "ALCHEMY_API_KEY not configured. Please set it in your environment.",
      };
    }

    const url = RPC_URLS[chain] + apiKey;

    try {
      const res = await context.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getBalance",
          params: [address, "latest"],
          id: 1,
        }),
      });

      if (!res.ok) {
        return {
          success: false,
          error: `RPC error: ${res.status} ${res.statusText}`,
        };
      }

      const data = await res.json();

      if (data.error) {
        return {
          success: false,
          error: `RPC error: ${data.error.message}`,
        };
      }

      const balanceWei = BigInt(data.result);
      const balanceEth = Number(balanceWei) / 1e18;

      return {
        success: true,
        data: {
          address,
          chain,
          balance: balanceEth.toFixed(6),
          balanceWei: balanceWei.toString(),
          symbol: NATIVE_SYMBOLS[chain],
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to fetch balance: ${err.message}`,
      };
    }
  },
};
