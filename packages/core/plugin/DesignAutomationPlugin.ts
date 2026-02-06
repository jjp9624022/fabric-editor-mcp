/*
 * @Author: Antigravity Automation
 * @Date: 2026-02-06
 * @Description: 自动化设计插件 - 全双向实时同步引擎 (无影子浏览器模式)
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
  ];

  private ws: WebSocket | null = null;
  private isProcessingRemote = false;
  private tokens: Record<string, string> = {};

  // 用于防止多次订阅
  private attachedHandlers: Record<string, any> = {};

  constructor(public canvas: fabric.Canvas, public editor: IEditor) {
    this._initLiveSync();
    this._initManualReporting();
  }

  /**
   * 初始化手动操作上报
   */
  private _initManualReporting() {
    this._removeListeners();

    this.attachedHandlers.reportChange = (e: any) => {
      if (this.isProcessingRemote || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const obj = e.target;
      if (!obj || obj.id === 'workspace') return;

      console.log('%c[Automation] 🛰️ 上报手动修改:', 'color: #8e44ad;', obj.id);
      this.ws.send(
        JSON.stringify({
          tool: 'update_node',
          args: {
            id: obj.id,
            props: {
              left: Math.round(obj.left),
              top: Math.round(obj.top),
              scaleX: obj.scaleX,
              scaleY: obj.scaleY,
              angle: obj.angle,
              fill: obj.fill,
            },
          },
          source: 'MANUAL_UI',
        })
      );
    };

    this.attachedHandlers.reportAdded = (e: any) => {
      if (this.isProcessingRemote || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const obj = e.target;
      if (!obj || obj.id === 'workspace' || (obj as any)._automation_ignore) return;

      if (!(obj as any).id) (obj as any).id = uuid();

      console.log('%c[Automation] 🛰️ 上报手动添加:', 'color: #2ecc71;', (obj as any).id);
      this.ws.send(
        JSON.stringify({
          tool: 'create_node',
          args: {
            type: obj.type,
            props: {
              id: (obj as any).id,
              left: Math.round(obj.left || 0),
              top: Math.round(obj.top || 0),
              fill: obj.fill,
              text: (obj as any).text || '',
            },
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

    this.canvas.on('object:modified', this.attachedHandlers.reportChange);
    this.canvas.on('object:added', this.attachedHandlers.reportAdded);
    this.canvas.on('object:removed', this.attachedHandlers.reportRemoved);
  }

  private _removeListeners() {
    if (this.attachedHandlers.reportChange)
      this.canvas.off('object:modified', this.attachedHandlers.reportChange);
    if (this.attachedHandlers.reportAdded)
      this.canvas.off('object:added', this.attachedHandlers.reportAdded);
    if (this.attachedHandlers.reportRemoved)
      this.canvas.off('object:removed', this.attachedHandlers.reportRemoved);
  }

  private _initLiveSync() {
    if (typeof window === 'undefined') return;

    // 确保单例连接
    if ((window as any)._automation_ws) {
      (window as any)._automation_ws.close();
    }

    const connect = () => {
      console.log(
        '%c[Automation] 🚀 正在尝试连接 MCP 同步服务器 (ws://localhost:8082)...',
        'color: #3498db; font-weight: bold;'
      );
      this.ws = new WebSocket('ws://localhost:8082');
      (window as any)._automation_ws = this.ws;

      this.ws.onopen = () => {
        console.log('%c[Automation] ✅ 实时双向同步已就绪', 'color: #27ae60; font-weight: bold;');
        this.ws?.send(JSON.stringify({ type: 'HANDSHAKE', client: 'BROWSER_EDITOR' }));
      };

      this.ws.onmessage = async (event) => {
        try {
          const dataStr = typeof event.data === 'string' ? event.data : String(event.data);
          const data = JSON.parse(dataStr);

          if (data.type === 'HEARTBEAT') return;

          if (data.type === 'REQUEST') {
            await this._handleDataRequest(data.tool, data.args, data.requestId);
            return;
          }

          const { tool, args } = data;
          if (!tool) return;

          this.isProcessingRemote = true;
          console.log(
            `%c[Automation] 📥 执行远程同步: ${tool}`,
            'background: #2c3e50; color: #ecf0f1; padding: 2px 5px;',
            args
          );

          switch (tool) {
            case 'create_node':
              this.createNode(args.type, args.props);
              break;
            case 'update_node':
              this.updateNodeProps(args.id, args.props);
              break;
            case 'delete_node':
              this.deleteNode(args.id);
              break;
            case 'clear_canvas':
              this.editor.clear();
              break;
            case 'set_background_color':
              if (typeof this.editor.setWorkspaseBg === 'function')
                this.editor.setWorkspaseBg(args.color);
              break;
            case 'position':
              {
                const centerPlugin = this.editor.getPlugin('CenterAlignPlugin');
                if (centerPlugin && typeof centerPlugin.position === 'function')
                  centerPlugin.position(args.type);
              }
              break;
            case 'apply_theme':
              this.applyTheme(args.colors);
              break;
            case 'set_design_tokens':
              this.setDesignTokens(args.tokens);
              break;
            default:
              break;
          }
          this.canvas.requestRenderAll();
        } catch (e) {
          console.error('[Automation] 同步执行失败', e);
        } finally {
          setTimeout(() => {
            this.isProcessingRemote = false;
          }, 50);
        }
      };

      this.ws.onclose = () => {
        console.log('%c[Automation] 🔌 连接已断开，正在重试...', 'color: #e74c3c;');
        setTimeout(connect, 5000);
      };
    };

    connect();
  }

  private async _handleDataRequest(tool: string, args: any, requestId: string) {
    if (!this.ws) return;
    let result: any = null;
    switch (tool) {
      case 'get_design_schema':
        result = this.getDesignSchema();
        break;
      case 'get_screenshot':
        result = await this.getScreenshot();
        break;
      default:
        break;
    }
    this.ws.send(JSON.stringify({ type: 'RESPONSE', requestId, payload: result }));
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
        style: { fill: o.fill },
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
