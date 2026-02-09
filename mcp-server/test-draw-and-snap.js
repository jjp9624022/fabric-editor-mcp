/**
 * MCP Drawing & Snapshot Test
 * 1. Connects to MCP
 * 2. Draws shapes
 * 3. Snapshots
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function testDrawAndSnap() {
  console.log('🚀 Starting Draw & Snap Test...\n');

  // Define server path
  const serverPath = path.join(__dirname, 'index.js');
  const rendererPath = path.join(__dirname, 'renderer.js');

  // 1. Connect Client (which spawns Server)
  console.log('🔌 Connecting MCP Client & Spawning Server...');
  const client = new Client({ name: 'test-gen-client', version: '1.0.0' }, { capabilities: {} });

  const clientTransport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: { ...process.env, PORT: '8082' },
  });

  await client.connect(clientTransport);
  console.log('✅ Client connected (Server started)');

  // Wait for the Server to start WS
  await new Promise((r) => setTimeout(r, 3000));

  // 2. Start Headless Renderer
  console.log('🎭 Starting Headless Renderer...');
  const renderer = spawn('node', [rendererPath], {
    stdio: 'inherit',
  });

  // Wait for renderer connection
  await new Promise((r) => setTimeout(r, 10000)); // Give it plenty of time to launch browser

  try {
    // --- DRAWING PHASE ---
    console.log('\n🎨 Phase 1: Drawing Shapes...');

    // 1. Red Rectangle
    console.log('  -> Creating Red Rectangle');
    await client.callTool({
      name: 'create_node',
      arguments: {
        type: 'rect',
        props: {
          id: 'rect-red',
          left: 50,
          top: 50,
          width: 200,
          height: 150,
          fill: '#FF6B6B',
          rx: 10,
          ry: 10,
        },
      },
    });

    // 2. Blue Circle
    console.log('  -> Creating Blue Circle');
    await client.callTool({
      name: 'create_node',
      arguments: {
        type: 'circle',
        props: {
          id: 'circle-blue',
          left: 300,
          top: 100,
          radius: 80,
          fill: '#4ECDC4',
        },
      },
    });

    // 3. Text
    console.log('  -> Creating Text');
    await client.callTool({
      name: 'create_node',
      arguments: {
        type: 'text',
        props: {
          id: 'text-hello',
          left: 100,
          top: 300,
          text: 'MCP Headless Gen',
          fontSize: 32,
          fill: '#2D3436',
          fontFamily: 'Arial',
        },
      },
    });

    // Wait a moment for render update
    await new Promise((r) => setTimeout(r, 1000));

    // --- SNAPSHOT PHASE ---
    console.log('\n📸 Phase 2: Taking Snapshot...');
    const result = await client.callTool({
      name: 'get_snapshot',
      arguments: {},
    });

    if (result.isError) {
      throw new Error(result.content[0].text);
    }

    const base64Data = result.content[0].text;
    console.log(`✅ Snapshot received (Length: ${base64Data.length})`);

    // Save it
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const outputPath = path.join(__dirname, '../snapshot_test.png');
    fs.writeFileSync(outputPath, cleanBase64, 'base64');
    console.log(`💾 Saved to ${outputPath}`);
  } catch (error) {
    console.error('❌ Test Failed:', error.message);
    if (error.content) console.error('Error details:', error.content);
  }

  // Cleanup
  console.log('🧹 Cleaning up...');
  await client.close();
  renderer.kill();
  process.exit(0);
}

testDrawAndSnap();
