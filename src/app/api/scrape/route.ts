import { NextRequest, NextResponse } from 'next/server';
import Firecrawl from '@mendable/firecrawl-js';

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    console.log('Scrape request received for URL:', url);

    if (!url) {
      console.log('No URL provided');
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      console.log('Firecrawl API key not found');
      return NextResponse.json({ error: 'Firecrawl API key not configured' }, { status: 500 });
    }

    console.log('Creating Firecrawl instance with API key');
    const firecrawl = new Firecrawl({ apiKey });

    console.log('Starting scrape operation...');
    const result = await firecrawl.scrape(url, {
      formats: ['markdown'],
      onlyMainContent: true
    });

    console.log('Scrape result:', JSON.stringify(result, null, 2));

    // Check if we have markdown content, regardless of success flag
    const markdown = result.markdown || '';
    const metadata = result.metadata || {};

    console.log('Extracted markdown length:', markdown.length);
    console.log('Metadata:', metadata);

    if (!markdown || markdown.length < 10) {
      console.log('No meaningful content extracted');
      return NextResponse.json({ 
        error: `Failed to extract content from URL. Error: ${'No meaningful content found'}` 
      }, { status: 500 });
    }

    const responseData = {
      content: markdown,
      title: metadata.title || 'Untitled',
      url: metadata.sourceURL || url
    };

    console.log('Returning successful response with data:', {
      contentLength: responseData.content.length,
      title: responseData.title
    });

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('Error scraping URL:', error);
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return NextResponse.json(
      { error: `Failed to scrape URL: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}