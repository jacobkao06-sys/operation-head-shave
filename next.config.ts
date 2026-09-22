import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The email templates in /templates are read at runtime so they can be
  // reseeded without a redeploy. Tell the tracer to ship them. SPEC.md §7.
  outputFileTracingIncludes: {
    "/api/**": ["./templates/**"],
    "/admin/**": ["./templates/**"],
  },
};

export default nextConfig;
