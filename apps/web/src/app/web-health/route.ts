export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    status: 'ok',
    service: 'nox-web',
    version: process.env.APP_VERSION ?? 'development',
  });
}
