/*
 * @Author: Antigravity Automation
 * @Date: 2026-02-06
 * @Description: 自动化设计插件 - 全方位双向实时同步引擎
 */

import { fabric } from 'fabric';
import { v4 as uuid } from 'uuid';
import type { IEditor, IPluginTempl } from '@kuaitu/core';

export default class DesignAutomationPlugin implements IPluginTempl {
  static pluginName = 'DesignAutomationPlugin';
  static apis = [
    'executeAction',
    'getDesignSchema',
    'applyTheme',
    'setDesignTokens',
    'getNodeContext',
    'updateNodeProps',
    'createNode',
    'deleteNode',
    'getScreenshot',
    'saveToCloud',
  ];

  private ws: WebSocket | null = null;
  private isProcessingRemote = false;
  private tokens: Record<string, string> = {};

  // 用于防止多次订阅
  private attachedHandlers: Record<string, any> = {};

  constructor(public canvas: fabric.Canvas, public editor: IEditor) {
    try {
      console.log(
        '%c[Automation] 🎉 DesignAutomationPlugin 构造函数被调用',
        'color: #3498db; font-weight: bold;'
      );
      console.log('[Automation] Canvas 对象:', this.canvas);
      console.log('[Automation] Editor 对象:', this.editor);
      this._initLiveSync();
      this._initManualReporting();
      this._hookEditorMethods();
      console.log(
        '%c[Automation] ✅ DesignAutomationPlugin 初始化完成',
        'color: #27ae60; font-weight: bold;'
      );
    } catch (error) {
      console.error('%c[Automation] ❌ 初始化失败:', 'color! #e74c3c; font-weight: bold;', error);
      throw error;
    }
  }

  /**
   * 劫持编辑器核心方法，确保任何变更（如颜色、字体修改）都能触发上报
   */
  private _hookEditorMethods() {
    if (typeof this.editor.saveState === 'function') {
      const originalSaveState = this.editor.saveState.bind(this.editor);
      this.editor.saveState = () => {
        originalSaveState();
        // 只要触发了 saveState，就说明有意义的变更发生了
        const activeObject = this.canvas.getActiveObject();
        if (activeObject) {
          if (activeObject.type === 'activeSelection') {
            (activeObject as fabric.ActiveSelection).getObjects().forEach((obj) => {
              this._reportManualChange(obj);
            });
          } else {
            this._reportManualChange(activeObject);
          }
        }
      };
    }
  }

  /**
   * 获取物体的全量属性快照
   */
  private _getObjectProps(obj: fabric.Object) {
    const props: any = {
      left: Math.round(obj.left || 0),
      top: Math.round(obj.top || 0),
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      angle: obj.angle,
      fill: obj.fill,
      stroke: obj.stroke,
      strokeWidth: obj.strokeWidth,
      opacity: obj.opacity,
      visible: obj.visible,
    };

    // 文本特有属性
    if (obj.type && obj.type.includes('text')) {
      Object.assign(props, {
        text: (obj as any).text,
        fontSize: (obj as any).fontSize,
        fontWeight: (obj as any).fontWeight,
        fontFamily: (obj as any).fontFamily,
        textAlign: (obj as any).textAlign,
        lineHeight: (obj as any).lineHeight,
        charSpacing: (obj as any).charSpacing,
      });
    }

    // 几何图形特有属性
    if (obj.type === 'circle') props.radius = (obj as any).radius;
    if (obj.type === 'rect') {
      props.rx = (obj as any).rx;
      props.ry = (obj as any).ry;
    }

    // 阴影
    if (obj.shadow && typeof obj.shadow === 'object') {
      const s = obj.shadow as fabric.Shadow;
      props.shadow = {
        color: s.color,
        blur: s.blur,
        offsetX: s.offsetX,
        offsetY: s.offsetY,
      };
    }

    return props;
  }

  /**
   * 处理来自 MCP Server 的远程指令
   */
  private _handleRemoteCommand(tool: string, args: any) {
    this.isProcessingRemote = true;

    try {
      switch (tool) {
        case 'create_node':
          this.createNode(args.type, args.props);
          console.log('%c[Automation] ✅ 执行 create_node', 'color: #27ae60;', args);
          break;
        case 'update_node':
          this.updateNodeProps(args.id, args.props);
          console.log('%c[Automation] ✅ 执行 update_node', 'color: #27ae60;', args);
          break;
        case 'delete_node':
          this.deleteNode(args.id);
          console.log('%c[Automation] ✅ 执行 delete_node', 'color: #27ae60;', args.id);
          break;
        case 'clear_canvas':
          this.editor.clear();
          console.log('%c[Automation] ✅ 执行 clear_canvas', 'color: #27ae60;');
          break;
        case 'apply_theme':
          this.applyTheme(args.colors);
          console.log('%c[Automation] ✅ 执行 apply_theme', 'color: #27ae60;', args.colors);
          break;
        case 'get_screenshot':
          // 仅用于消除警告，实际逻辑在 _handleDataRequest 中处理
          break;
        case 'save_to_cloud':
          console.log('[Automation] ☁️ Triggering save_to_cloud event...');
          this.editor.emit('automation:save-to-cloud', args);
          break;
        default:
          console.warn('[Automation] 未知指令:', tool);
      }
    } catch (error) {
      console.error('[Automation] 指令执行失败:', error);
    } finally {
      // 延迟重置标志，确保所有事件都完成
      setTimeout(() => {
        this.isProcessingRemote = false;
      }, 100);
    }
  }

  /**
   * 执行手动变更上报
   */
  private _reportManualChange(obj: fabric.Object) {
    if (this.isProcessingRemote || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!obj || (obj as any).id === 'workspace') return;

    console.log('%c[Automation] 🛰️ 上报属性变更:', 'color: #8e44ad;', (obj as any).id);
    this.ws.send(
      JSON.stringify({
        tool: 'update_node',
        args: {
          id: (obj as any).id,
          props: this._getObjectProps(obj),
        },
        source: 'MANUAL_UI',
      })
    );
  }

  /**
   * 初始化手动操作上报事件监听
   */
  private _initManualReporting() {
    this._removeListeners();

    this.attachedHandlers.reportChange = (e: any) => {
      this._reportManualChange(e.target);
    };

    this.attachedHandlers.reportAdded = (e: any) => {
      if (this.isProcessingRemote || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const obj = e.target;
      if (!obj || (obj as any).id === 'workspace' || (obj as any)._automation_ignore) return;

      if (!(obj as any).id) (obj as any).id = uuid();

      console.log('%c[Automation] 🛰️ 上报手动添加:', 'color: #2ecc71;', (obj as any).id);
      this.ws.send(
        JSON.stringify({
          tool: 'create_node',
          args: {
            type: obj.type,
            props: Object.assign({ id: (obj as any).id }, this._getObjectProps(obj)),
          },
          source: 'MANUAL_UI',
        })
      );
    };

    this.attachedHandlers.reportRemoved = (e: any) => {
      if (this.isProcessingRemote || !this.ws) return;
      const obj = e.target as any;
      if (obj && obj.id && obj.id !== 'workspace') {
        console.log('%c[Automation] 🛰️ 上报手动删除:', 'color: #e74c3c;', obj.id);
        this.ws.send(
          JSON.stringify({
            tool: 'delete_node',
            args: { id: obj.id },
            source: 'MANUAL_UI',
          })
        );
      }
    };

    // 基础变更事件
    this.canvas.on('object:modified', this.attachedHandlers.reportChange);
    this.canvas.on('object:added', this.attachedHandlers.reportAdded);
    this.canvas.on('object:removed', this.attachedHandlers.reportRemoved);
    // 文本输入实时变更
    this.canvas.on('text:changed', this.attachedHandlers.reportChange);
  }

  private _removeListeners() {
    if (this.attachedHandlers.reportChange)
      this.canvas.off('object:modified', this.attachedHandlers.reportChange);
    if (this.attachedHandlers.reportAdded)
      this.canvas.off('object:added', this.attachedHandlers.reportAdded);
    if (this.attachedHandlers.reportRemoved)
      this.canvas.off('object:removed', this.attachedHandlers.reportRemoved);
    this.canvas.off('text:changed', this.attachedHandlers.reportChange);
  }

  private _initLiveSync() {
    if (typeof window === 'undefined') {
      console.log('[Automation] ⚠️ window 未定义，跳过 WebSocket 初始化');
      return;
    }

    console.log('[Automation] 📍 window 类型检测通过，准备初始化 WebSocket');

    if ((window as any)._automation_ws) {
      console.log('[Automation] 🔄 关闭现有 WebSocket 连接');
      (window as any)._automation_ws.close();
    }

    // WebSocket URL 配置优先级：
    // 1. 运行时通过 window 对象配置
    // 2. 默认连接到宿主机 localhost:8082（MCP Server 在宿主机运行）
    const wsUrl =
      (window as any).__MCP_WS_URL__ || (window as any).MCP_WS_URL || 'ws://localhost:8082';

    const connect = () => {
      console.log(
        '%c[Automation] 🚀 正在尝试连接 MCP 同步服务器...',
        'color: #3498db; font-weight: bold;'
      );
      console.log(`[Automation] 📍 WebSocket URL: ${wsUrl}`);
      this.ws = new WebSocket(wsUrl);
      (window as any)._automation_ws = this.ws;

      this.ws.onopen = () => {
        console.log('%c[Automation] ✅ 实时双向同步已就绪', 'color: #27ae60; font-weight: bold;');
        const handshakeMsg = JSON.stringify({ type: 'HANDSHAKE', client: 'BROWSER_EDITOR' });
        console.log('[Automation] 📤 发送握手消息:', handshakeMsg);
        this.ws?.send(handshakeMsg);

        // 连接成功后立即发送一次全量初始化同步
        this._reportInitialState();
      };

      this.ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          console.log('[Automation] 📥 收到消息:', msg.type || msg.tool, msg);

          // 处理来自 MCP Server 的远程指令
          if (msg.tool && msg.args) {
            console.log('%c[Automation] 📥 收到远程指令:', 'color: #e67e22;', msg.tool, msg.args);
            this._handleRemoteCommand(msg.tool, msg.args);
          }

          // 处理数据请求（带 requestId 的）
          if (msg.tool && msg.requestId) {
            this._handleDataRequest(msg.tool, msg.args, msg.requestId);
          }
        } catch (error) {
          console.error('[Automation] 消息处理失败:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('%c[Automation] 🔌 连接断开，3秒后重连...', 'color: #e74c3c;');
        setTimeout(connect, 3000);
      };

      this.ws.onerror = (error) => {
        console.error('[Automation] WebSocket 错误:', error);
      };
    };

    connect();
  }

  /**
   * 上报当前画布的全量状态
   */
  private _reportInitialState() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    console.log('%c[Automation] 🛰️ 执行全量初始化同步...', 'color: #3498db;');
    const schema = this.getDesignSchema();
    this.ws.send(
      JSON.stringify({
        type: 'INITIAL_STATE_SYNC',
        payload: {
          layers: schema.layers,
          background: this.editor.getWorkspase
            ? (this.editor.getWorkspase() as any).fill
            : '#ffffff',
        },
      })
    );
  }

  private async _handleDataRequest(tool: string, args: any, requestId: string) {
    if (!this.ws) return;
    console.log(`[Automation] 📸 Processing data request: ${tool} (${requestId})`);
    let result: any = null;
    switch (tool) {
      case 'get_design_schema':
        result = this.getDesignSchema();
        break;
      case 'get_screenshot':
        console.log('[Automation] 📸 Calling this.getScreenshot()...');
        result = await this.getScreenshot();
        console.log(`[Automation] 📸 Screenshot result length: ${result ? result.length : 0}`);
        break;
      case 'save_to_cloud':
        console.log('[Automation] ☁️ Triggering save_to_cloud event...');
        this.editor.emit('automation:save-to-cloud', args);
        result = { status: 'triggered' };
        break;
      default:
        break;
    }
    if (result) {
      console.log(`[Automation] 📤 Sending RESPONSE for ${requestId}`);
      this.ws.send(JSON.stringify({ type: 'RESPONSE', requestId, payload: result }));
    } else {
      console.warn(`[Automation] ⚠️ No result generated for ${tool} (${requestId})`);
    }
  }

  // --- 核心操作方法 ---

  public createNode(type: string, props: any) {
    let obj: any;
    const id = props.id || uuid();
    const finalProps = { ...props, id };
    if (finalProps.fill && this.tokens[finalProps.fill])
      finalProps.fill = this.tokens[finalProps.fill];

    switch (type.toLowerCase()) {
      case 'rect':
        obj = new fabric.Rect({ width: 100, height: 100, ...finalProps });
        break;
      case 'circle':
        obj = new fabric.Circle({ radius: 50, ...finalProps });
        break;
      case 'text':
      case 'i-text':
      case 'textbox':
        obj = new fabric.IText(props.text || 'Text', { fontSize: 24, ...finalProps });
        break;
      default:
        break;
    }

    if (obj) {
      (obj as any)._automation_ignore = true;
      this.canvas.add(obj);
      this.canvas.setActiveObject(obj);
      setTimeout(() => {
        delete (obj as any)._automation_ignore;
      }, 100);
    }
    this._save();
    return { id };
  }

  public updateNodeProps(id: string, props: any) {
    const obj = this._find(id);
    if (!obj) return;
    if (props.fill && this.tokens[props.fill]) props.fill = this.tokens[props.fill];
    obj.set(props);
    obj.setCoords();
    this._save();
  }

  public deleteNode(id: string) {
    const obj = this._find(id);
    if (obj) {
      this.canvas.remove(obj);
      this._save();
    }
  }

  public getDesignSchema() {
    const objects = this.canvas.getObjects().filter((o) => o.id !== 'workspace');
    return {
      layers: objects.map((o) => ({
        type: o.type,
        id: (o as any).id,
        text: (o as any).text || '',
        position: { x: Math.round(o.left!), y: Math.round(o.top!) },
        style: this._getObjectProps(o),
      })),
    };
  }

  public setDesignTokens(tokens: Record<string, string>) {
    this.tokens = { ...this.tokens, ...tokens };
  }

  public applyTheme(colors: string[]) {
    this.canvas.getObjects().forEach((obj, i) => {
      if (obj.id !== 'workspace') {
        const color = colors[i % colors.length];
        obj.set('fill', this.tokens[color] || color);
      }
    });
    this._save();
  }

  public async getScreenshot() {
    return typeof this.editor.preview === 'function' ? await this.editor.preview() : '';
  }

  public getNodeContext(id: string) {
    const obj = this._find(id);
    return obj
      ? {
          id: (obj as any).id,
          type: obj.type,
          left: obj.left,
          top: obj.top,
          width: obj.getScaledWidth(),
          height: obj.getScaledHeight(),
          props: this._getObjectProps(obj),
        }
      : null;
  }

  private _find(id: string) {
    return this.canvas.getObjects().find((o) => (o as any).id === id);
  }

  private _save() {
    this.canvas.requestRenderAll();
    if (typeof this.editor.saveState === 'function') this.editor.saveState();
  }

  public async executeAction(type: string, payload: any) {
    switch (type) {
      case 'CREATE_NODE':
        return this.createNode(payload.type, payload.props);
      case 'CLEAN_UP':
        return this.editor.clear();
      default:
        return null;
    }
  }

  public destory() {
    this._removeListeners();
    if (this.ws) this.ws.close();
  }
}
