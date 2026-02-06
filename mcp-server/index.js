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
      const layer = localDesignState.layers.find((l) => l.id === args.id);
      if (layer) {
        Object.assign(layer, args.props);
        console.error(`[STATE] 📝 更新节点: ${args.id}`);
      } else {
        console.error(`[STATE] ⚠️ 尝试更新不存在的节点: ${args.id}`);
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

      // 处理来自浏览器的实时变更上报
      if (msg.source === 'MANUAL_UI') {
        updateLocalState(msg);
        // 将此变更转发给其他可能打开的浏览器标签页
        broadcastAction(msg, ws);
      }

      if (msg.type === 'HANDSHAKE') {
        console.error(`[WS] 🤝 握手成功: ${msg.client}`);
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
        updateLocalState({ tool: name, args });
        broadcastAction({ tool: name, args });
        return { content: [{ type: 'text', text: `已执行并同步: ${name}` }] };
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
  console.error('Vue Fabric Editor Local-State MCP v6.0 Ready (Shadowless)');
}

main().catch(console.error);
