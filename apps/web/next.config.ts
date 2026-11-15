import type { NextConfig } from "next";

if (process.env.NODE_ENV === "production") {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) throw new Error("NEXT_PUBLIC_API_URL is required for a production Web build.");
  let parsedApiUrl: URL;
  try { parsedApiUrl = new URL(apiUrl); } catch { throw new Error("NEXT_PUBLIC_API_URL must be an absolute HTTPS URL."); }
  if (parsedApiUrl.protocol !== "https:" || parsedApiUrl.origin !== apiUrl || parsedApiUrl.username || parsedApiUrl.password || parsedApiUrl.search || parsedApiUrl.hash) throw new Error("NEXT_PUBLIC_API_URL must be an HTTPS origin without credentials, path, query, or fragment.");
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Telegram Web may host Mini Apps in a cross-origin frame; explicitly allow
  // Telegram's official web clients instead of using X-Frame-Options: DENY.
  { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org https://*.t.me; object-src 'none'; base-uri 'self';" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
