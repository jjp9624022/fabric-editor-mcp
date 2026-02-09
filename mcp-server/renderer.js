const { chromium } = require('playwright');
const path = require('path');

(async () => {
  console.log('🚀 Starting Headless Renderer...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'], // Useful for some environments
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Log console messages from the browser to our stdout
  page.on('console', (msg) => {
    const text = msg.text();
    // Filter out some noise if needed, but show Automation logs
    if (text.includes('[Automation]') || text.includes('[WS]')) {
      console.log('BROWSER:', text);
    }
  });

  page.on('pageerror', (err) => {
    console.error('BROWSER ERROR:', err);
  });

  const targetUrl = process.env.TARGET_URL || 'http://localhost:3000';
  const wsUrl = process.env.WS_URL || 'ws://localhost:8082';
  const authToken = process.env.AUTH_TOKEN;

  console.log(`Connecting to ${targetUrl}...`);
  console.log(`Using WebSocket URL: ${wsUrl}`);
  if (authToken) console.log('Using Auth Token for cloud saving');

  // Inject WS URL and Auth Token if needed
  await page.addInitScript(
    ({ url, token }) => {
      window.__MCP_WS_URL__ = url;
      if (token) {
        localStorage.setItem('token', token);
        console.log('[Automation] 🔑 Injected Auth Token into localStorage');
      }
    },
    { url: wsUrl, token: authToken }
  );

  try {
    await page.goto(targetUrl);
    console.log('✅ Page loaded');

    // Keep alive
    console.log('Renderer running. Press Ctrl+C to exit.');

    // Optional: Check for canvas presence
    try {
      await page.waitForSelector('canvas.lower-canvas', { timeout: 30000 }); // Increase timeout
      console.log('✅ Canvas detected');
    } catch (e) {
      console.warn('⚠️ Canvas not detected immediately:', e.message);
      await page.screenshot({ path: 'page_error.png' });
      console.log('Saved page_error.png for debugging');
    }
  } catch (e) {
    console.error('❌ Failed to load page:', e);
    process.exit(1);
  }
})();
