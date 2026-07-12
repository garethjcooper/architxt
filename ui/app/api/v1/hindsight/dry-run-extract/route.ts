import { NextResponse } from 'next/server';

const API_BASE = process.env.ARCHITXT_UI_API_BASE_URL || 'http://localhost:3000';
const TIMEOUT_MS = 120_000;

export async function POST(request: Request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const body = await request.json();
    const response = await fetch(`${API_BASE}/api/v1/hindsight/dry-run-extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);

    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Dry-run request timed out', code: 'PROXY_TIMEOUT' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: error.message || 'Proxy request failed', code: 'PROXY_ERROR' },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
