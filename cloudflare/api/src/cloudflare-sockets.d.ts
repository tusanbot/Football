declare module "cloudflare:sockets" {
  export interface Socket {
    opened: Promise<{
      remoteAddress?: string | null;
      localAddress?: string | null;
    }>;
    close(): void;
  }

  export function connect(
    address: { hostname: string; port: number },
    options?: {
      secureTransport?: "off" | "on" | "starttls";
      allowHalfOpen?: boolean;
    },
  ): Socket;
}
