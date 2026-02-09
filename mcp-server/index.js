const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const WebSocket = require('ws');

/**
 * 轻量级状态机：在服务器本地维护画布状态
 */
const localDesignState = {
  layers: [],
  background: '#ffffff',
  tokens: {},
};

// 1. WebSocket 服务器管理
const wss = new WebSocket.Server({ port: 8082 });
const activeConnections = new Set();
const pendingRequests = new Map(); // Store pending tool requests

/**
 * 更新本地维护的状态
 */
function updateLocalState(msg) {
  const { tool, args, source } = msg;
  console.error(`[STATE] 📥 收到变更 (${source || 'AI'}): ${tool}`);

  switch (tool) {
    case 'create_node': {
      const newNode = { id: args.props.id, type: args.type, ...args.props };
      localDesignState.layers.push(newNode);
      console.error(`[STATE] ✨ 新增节点: ${newNode.id} (${newNode.type})`);
      break;
    }
    case 'update_node': {
      let layer = localDesignState.layers.find((l) => l.id === args.id);
      if (layer) {
        Object.assign(layer, args.props);
        console.error(`[STATE] 📝 更新节点: ${args.id}`);
      } else {
        // 如果节点不存在，则视作延迟创建（Upsert）
        console.error(`[STATE] ℹ️ 节点不存在，执行自动创建: ${args.id}`);
        const newNode = { id: args.id, ...args.props };
        localDesignState.layers.push(newNode);
      }
      break;
    }
    case 'delete_node': {
      localDesignState.layers = localDesignState.layers.filter((l) => l.id !== args.id);
      console.error(`[STATE] 🗑️ 删除节点: ${args.id}`);
      break;
    }
    case 'clear_canvas': {
      localDesignState.layers = [];
      console.error(`[STATE] 🧹 画布已清空`);
      break;
    }
    case 'set_background_color': {
      localDesignState.background = args.color;
      console.error(`[STATE] 🎨 背景色已更新: ${args.color}`);
      break;
    }
    case 'set_design_tokens': {
      Object.assign(localDesignState.tokens, args.tokens);
      console.error(`[STATE] 💎 Tokens 已更新`);
      break;
    }
    default:
      break;
  }
}

/**
 * 广播动作
 */
function broadcastAction(action, skipWs = null) {
  const data = JSON.stringify(action);
  activeConnections.forEach((ws) => {
    if (ws !== skipWs && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

wss.on('connection', (ws) => {
  activeConnections.add(ws);
  console.error('[WS] 🛰️ 浏览器已连接，实时状态同步开启');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      // 处理来自浏览器的上报或测试脚本的指令
      if (
        msg.source === 'MANUAL_UI' ||
        msg.source === 'AI' ||
        msg.source === 'TEST' ||
        msg.source === 'TEST_SCRIPT' ||
        msg.source === 'MCP_TEST' ||
        msg.source === 'TEST_PATTERN'
      ) {
        updateLocalState(msg);
        broadcastAction(msg, ws);

        // 给发送者发送确认响应（用于测试脚本验证）
        if (msg.source !== 'MANUAL_UI' && msg.tool !== 'get_screenshot') {
          const response = {
            type: 'RESPONSE',
            requestId: Date.now().toString(),
            tool: msg.tool,
            status: 'success',
            message: `已执行: ${msg.tool}`,
          };
          ws.send(JSON.stringify(response));
        }
      }

      // Handle async responses for tools like get_snapshot
      if (msg.type === 'RESPONSE' && msg.requestId) {
        // Broadcast back to other clients (like test scripts)
        broadcastAction(msg, ws);

        const pending = pendingRequests.get(msg.requestId);
        if (pending) {
          pending.resolve(msg.payload);
          pendingRequests.delete(msg.requestId);
        }
      }

      if (msg.type === 'HANDSHAKE') {
        console.error(`[WS] 🤝 握手成功: ${msg.client}`);
      }

      // 处理全量初始化同步
      if (msg.type === 'INITIAL_STATE_SYNC') {
        console.error(`[STATE] 📥 收到全量初始化，正在重置本地状态机...`);
        localDesignState.layers = msg.payload.layers.map((layer) => ({
          id: layer.id,
          type: layer.type,
          ...layer.style,
        }));
        localDesignState.background = msg.payload.background;
        console.error(`[STATE] ✅ 初始化完成: ${localDesignState.layers.length} 个图层`);
      }
    } catch (e) {
      console.error('[WS] ❌ 处理消息失败:', e.message);
    }
  });

  ws.on('close', () => {
    console.error('[WS] 🔌 浏览器连接断开');
    activeConnections.delete(ws);
  });
});

// 2. MCP Server 定义
const server = new Server(
  { name: 'vue-fabric-editor-local-state-mcp', version: '6.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_design_schema',
        description: '获取当前设计的本地架构描述（实时同步）',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'create_node',
        description: '创建一个新图层',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['rect', 'circle', 'text'] },
            props: { type: 'object' },
          },
          required: ['type', 'props'],
        },
      },
      {
        name: 'update_node',
        description: '更新指定图层的属性',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            props: { type: 'object' },
          },
          required: ['id', 'props'],
        },
      },
      {
        name: 'clear_canvas',
        description: '清空画布',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'apply_theme',
        description: '应用配色方案',
        inputSchema: {
          type: 'object',
          properties: { colors: { type: 'array', items: { type: 'string' } } },
          required: ['colors'],
        },
      },
      {
        name: 'draw_test_pattern',
        description: '绘制测试图案（一组预设图形，实时同步到浏览器）',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get_snapshot',
        description: 'Capture a snapshot of the current canvas (returns base64 image)',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'save_to_cloud',
        description: 'Save the current canvas to the user account space (requires authentication)',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name for the saved file' },
            id: { type: 'string', description: 'Existing template ID to update' },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_design_schema': {
        return { content: [{ type: 'text', text: JSON.stringify(localDesignState, null, 2) }] };
      }
      case 'create_node':
      case 'update_node':
      case 'clear_canvas':
      case 'apply_theme': {
        updateLocalState({ tool: name, args, source: 'AI' });
        broadcastAction({ tool: name, args });
        return { content: [{ type: 'text', text: `已执行并同步: ${name}` }] };
      }
      case 'draw_test_pattern': {
        console.error(`[MCP TEST] 开始绘制测试图案...`);

        // 1. 创建红色圆角矩形
        const rect1Action = {
          tool: 'create_node',
          args: {
            type: 'rect',
            props: {
              id: 'test-rect-1',
              left: 50,
              top: 50,
              width: 200,
              height: 150,
              fill: '#FF6B6B',
              rx: 10,
              ry: 10,
            },
          },
        };
        updateLocalState({ ...rect1Action, source: 'MCP_TEST' });
        broadcastAction(rect1Action);
        console.error(`  [MCP TEST] ✨ 红色圆角矩形`);

        // 2. 创建蓝色圆形
        const circle1Action = {
          tool: 'create_node',
          args: {
            type: 'circle',
            props: { id: 'test-circle-1', left: 350, top: 125, radius: 80, fill: '#4ECDC4' },
          },
        };
        updateLocalState({ ...circle1Action, source: 'MCP_TEST' });
        broadcastAction(circle1Action);
        console.error(`  [MCP TEST] 🔵 蓝色圆形`);

        // 3. 创建文本
        const text1Action = {
          tool: 'create_node',
          args: {
            type: 'text',
            props: {
              id: 'test-text-1',
              left: 100,
              top: 300,
              text: 'Hello MCP!',
              fontSize: 40,
              fill: '#2D3436',
              fontFamily: 'Arial',
            },
          },
        };
        updateLocalState({ ...text1Action, source: 'MCP_TEST' });
        broadcastAction(text1Action);
        console.error(`  [MCP TEST] 📝 文本`);

        // 4. 创建旋转的黄色矩形
        const rect2Action = {
          tool: 'create_node',
          args: {
            type: 'rect',
            props: {
              id: 'test-rect-2',
              left: 250,
              top: 350,
              width: 180,
              height: 120,
              fill: '#FFE66D',
              angle: 15,
            },
          },
        };
        updateLocalState({ ...rect2Action, source: 'MCP_TEST' });
        broadcastAction(rect2Action);
        console.error(`  [MCP TEST] 🟡 黄色旋转矩形`);

        console.error(`[MCP TEST] ✅ 完成！当前图层数: ${localDesignState.layers.length}`);

        return {
          content: [
            {
              type: 'text',
              text: `✅ 测试图案绘制完成！\n已同步到浏览器，图层数: ${localDesignState.layers.length}\n\n请在浏览器编辑器中查看图形。`,
            },
          ],
        };
      }
      case 'get_snapshot': {
        const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.error(`[SNAPSHOT] Requesting snapshot with ID: ${requestId}`);

        broadcastAction({
          tool: 'get_screenshot',
          requestId: requestId,
          args: {},
        });

        // Wait for response with timeout
        try {
          const base64Content = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              pendingRequests.delete(requestId);
              reject(new Error('Snapshot request timed out'));
            }, 10000); // 10s timeout

            pendingRequests.set(requestId, {
              resolve: (data) => {
                clearTimeout(timeout);
                resolve(data);
              },
              reject,
            });
          });

          return {
            content: [
              {
                type: 'text',
                text: base64Content, // This should be the base64 data URL
              },
            ],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Snapshot failed: ${error.message}` }],
            isError: true,
          };
        }
      }
      case 'save_to_cloud': {
        const requestId = `req-save-${Date.now()}`;
        console.error(`[SAVE] Triggering cloud save: ${args.name || 'Untitled'}`);

        broadcastAction({
          tool: 'save_to_cloud',
          requestId: requestId,
          args: args,
        });

        return {
          content: [{ type: 'text', text: 'Cloud save triggered. Check remote logs for status.' }],
        };
      }
      default:
        throw new Error(`未知工具: ${name}`);
    }
  } catch (error) {
    return { content: [{ type: 'text', text: error.message }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Vue Fabric Editor Local-State MCP v6.1 Ready (Robust Sync)');
}

main().catch(console.error);
