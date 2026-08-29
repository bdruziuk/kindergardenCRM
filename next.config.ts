import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output keeps the Docker/Railway image small; harmless elsewhere.
  output: "standalone",
  // nodemailer тягне за собою динамічні require і не входить у список пакетів,
  // які Next виносить назовні сам, — без цього SMTP у збірці не піднімається.
  serverExternalPackages: ["nodemailer"],
};

export default nextConfig;
