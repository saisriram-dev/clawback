/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Parsers run only on the server; keep them out of the bundler.
  serverExternalPackages: ['unpdf', 'mammoth', 'postal-mime', 'read-excel-file'],
  poweredByHeader: false,
  devIndicators: false,
};
export default nextConfig;
