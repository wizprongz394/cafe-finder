// app/api/osm/route.ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const query = await request.text();
    
    // Use Overpass API endpoint
    const overpassUrl = 'https://overpass-api.de/api/interpreter';
    
    const response = await fetch(overpassUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!response.ok) {
      console.error('Overpass API error:', response.status);
      return NextResponse.json(
        { error: `Overpass API returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    // Add cache headers
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=1800',
        'X-Cache': 'FRESH',
      },
    });
  } catch (error) {
    console.error('OSM API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch places from OpenStreetMap' },
      { status: 500 }
    );
  }
}