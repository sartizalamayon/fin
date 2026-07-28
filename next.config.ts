import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * pdf.js must stay external to the server bundle.
   *
   * Bundling it works locally — `next start` resolves everything from
   * node_modules — but Vercel builds each route into a traced lambda, and the
   * tracer cannot follow pdf.js's dynamic resolution of its worker and
   * standard-font files. Those pieces are silently left out, the module throws
   * on import, and /api/documents 500s with an HTML error page before running a
   * single line of its own code. The upload UI then reports "could not reach
   * the server", which points at the network rather than here.
   */
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
