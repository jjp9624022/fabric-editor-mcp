<!--
 * @Author: 秦少卫
 * @Date: 2024-05-17 15:30:21
 * @LastEditors: 秦少卫
 * @LastEditTime: 2024-11-18 10:30:30
 * @Description: file content
-->
<template>
  <div class="home">
    <Layout>
      <!-- 头部区域 -->
      <Top v-if="state.show" :ruler="state.ruler" @update:ruler="rulerSwitch"></Top>
      <Content style="display: flex; height: calc(100vh - 64px); position: relative">
        <!-- 左侧区域 -->
        <Left v-if="state.show"></Left>
        <!-- 画布区域 -->
        <div id="workspace">
          <div class="canvas-box">
            <div class="inside-shadow"></div>
            <canvas id="canvas" :class="state.ruler ? 'design-stage-grid' : ''"></canvas>
            <dragMode v-if="state.show"></dragMode>
            <zoom></zoom>
          </div>
        </div>
        <Right v-if="state.show"></Right>
      </Content>
    </Layout>
  </div>
</template>

<script name="Home" setup lang="ts">
import Top from './components/top/index.vue';
import Left from './components/left/index.vue';
import Right from './components/right/index.vue';

import zoom from '@/components/zoom.vue';
import dragMode from '@/components/dragMode.vue';
// 功能组件
import { fabric } from 'fabric';

import Editor, {
  IEditor,
  DringPlugin,
  AlignGuidLinePlugin,
  ControlsPlugin,
  // ControlsRotatePlugin,
  CenterAlignPlugin,
  LayerPlugin,
  CopyPlugin,
  MoveHotKeyPlugin,
  DeleteHotKeyPlugin,
  GroupPlugin,
  DrawLinePlugin,
  GroupTextEditorPlugin,
  GroupAlignPlugin,
  WorkspacePlugin,
  HistoryPlugin,
  FlipPlugin,
  RulerPlugin,
  MaterialPlugin,
  WaterMarkPlugin,
  FontPlugin,
  PolygonModifyPlugin,
  DrawPolygonPlugin,
  FreeDrawPlugin,
  PathTextPlugin,
  PsdPlugin,
  SimpleClipImagePlugin,
  BarCodePlugin,
  QrCodePlugin,
  ImageStroke,
  ResizePlugin,
  LockPlugin,
  AddBaseTypePlugin,
  MaskPlugin,
  DesignAutomationPlugin,
} from '@kuaitu/core';

const APIHOST = import.meta.env.APP_APIHOST;

import useMaterial from '@/hooks/useMaterial';
import { useRoute } from 'vue-router';
import dayjs from 'dayjs';

const route = useRoute();
// const { createTmplByCommon, updataTemplInfo } = useMaterial();

// 创建编辑器
const canvasEditor = new Editor() as IEditor;

const state = reactive({
  show: false,
  select: null,
  ruler: true,
});

onMounted(() => {
  // 初始化fabric
  const canvas = new fabric.Canvas('canvas', {
    fireRightClick: true, // 启用右键，button的数字为3
    stopContextMenu: true, // 禁止默认右键菜单
    controlsAboveOverlay: true, // 超出clipPath后仍然展示控制条
    // imageSmoothingEnabled: false, // 解决文字导出后不清晰问题
    preserveObjectStacking: true, // 当选择画布中的对象时，让对象不在顶层。
  });

  // 初始化编辑器
  canvasEditor.init(canvas);
  canvasEditor
    .use(DringPlugin)
    .use(PolygonModifyPlugin)
    .use(AlignGuidLinePlugin)
    .use(ControlsPlugin)
    // .use(ControlsRotatePlugin)
    .use(CenterAlignPlugin)
    .use(LayerPlugin)
    .use(CopyPlugin)
    .use(MoveHotKeyPlugin)
    .use(DeleteHotKeyPlugin)
    .use(GroupPlugin)
    .use(DrawLinePlugin)
    .use(GroupTextEditorPlugin)
    .use(GroupAlignPlugin)
    .use(WorkspacePlugin)
    .use(HistoryPlugin)
    .use(FlipPlugin)
    .use(RulerPlugin)
    .use(DrawPolygonPlugin)
    .use(FreeDrawPlugin)
    .use(PathTextPlugin)
    .use(SimpleClipImagePlugin)
    .use(BarCodePlugin)
    .use(QrCodePlugin)
    .use(FontPlugin, {
      repoSrc: APIHOST,
    })
    .use(MaterialPlugin, {
      repoSrc: APIHOST,
    })
    .use(WaterMarkPlugin)
    .use(PsdPlugin)
    .use(ImageStroke)
    .use(ResizePlugin)
    .use(LockPlugin)
    .use(AddBaseTypePlugin)
    .use(MaskPlugin)
    .use(DesignAutomationPlugin);

  state.show = true;
  // 暴露给全局，方便 MCP 等自动化工具调用
  window.canvasEditor = canvasEditor;
  window.fabric = fabric;

  // 监听自动化保存事件
  canvasEditor.on('automation:save-to-cloud', async (args: any) => {
    console.log('%c[Automation] ☁️ 收到云端保存指令', 'color: #3498db; font-weight: bold;', args);
    try {
      // Manual save logic using local canvasEditor instead of hook's injected one
      const json = canvasEditor.getJson();
      const base64 = await canvasEditor.preview();

      // Upload
      const { uploadImg, createdTempl, updataTempl } = await import('@/api/user');
      const dataURLtoFile = (dataurl: string, filename: string) => {
        const arr = dataurl.split(',');
        const mime = arr[0].match(/:(.*?);/)![1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        return new File([u8arr], filename, { type: mime });
      };

      const file = dataURLtoFile(base64, 'automation.png');
      const formData = new FormData();
      formData.append('files', file, `${Date.now()}`);
      const uploadRes = await uploadImg(formData);
      const fileInfo = uploadRes.data[0];

      const saveData = {
        json,
        img: fileInfo.id,
        desc: 'AI Generated',
        name: args.name || dayjs().format('YYYY-MM-DD HH:mm:ss') + ' AI作品',
      };

      if (route?.query?.id || args.id) {
        await updataTempl(route?.query?.id || args.id, { data: saveData });
        console.log('%c[Automation] ✅ 云端保存完成（更新）', 'color: #27ae60;');
      } else {
        const res = await createdTempl({
          data: {
            ...saveData,
            type: 'file',
            parentId: '',
          },
        });
        console.log('%c[Automation] ✅ 云端保存完成（创建）', 'color: #27ae60;', res.data.data.id);
      }
    } catch (error) {
      console.error('[Automation] ❌ 云端保存失败:', error);
    }
  });

  // 默认打开标尺
  if (state.ruler) {
    canvasEditor.rulerEnable();
  }
});

onUnmounted(() => canvasEditor.destory());
const rulerSwitch = (val) => {
  if (val) {
    canvasEditor.rulerEnable();
  } else {
    canvasEditor.rulerDisable();
  }
  // 使标尺开关组件失焦，避免响应键盘的空格事件
  document.activeElement.blur();
};

provide('fabric', fabric);
provide('canvasEditor', canvasEditor);
// provide('mixinState', mixinState);
</script>

<style lang="less" scoped>
:deep(.ivu-layout-header) {
  --height: 45px;
  padding: 0 0px;
  border-bottom: 1px solid #eef2f8;
  background: #fff;
  height: var(--height);
  line-height: var(--height);
  display: flex;
  justify-content: space-between;
}

.home,
.ivu-layout {
  height: 100vh;
}

.icon {
  display: block;
}

.canvas-box {
  position: relative;
}

// 画布内阴影
.inside-shadow {
  position: absolute;
  width: 100%;
  height: 100%;
  box-shadow: inset 0 0 9px 2px #0000001f;
  z-index: 2;
  pointer-events: none;
}

#canvas {
  width: 300px;
  height: 300px;
  margin: 0 auto;
}

#workspace {
  flex: 1;
  width: 100%;
  position: relative;
  background: #f1f1f1;
  overflow: hidden;
}

// 标尺
.switch {
  margin-right: 10px;
}

// 网格背景
.design-stage-grid {
  --offsetX: 0px;
  --offsetY: 0px;
  --size: 16px;
  --color: #dedcdc;
  background-image: linear-gradient(
      45deg,
      var(--color) 25%,
      transparent 0,
      transparent 75%,
      var(--color) 0
    ),
    linear-gradient(45deg, var(--color) 25%, transparent 0, transparent 75%, var(--color) 0);
  background-position: var(--offsetX) var(--offsetY),
    calc(var(--size) + var(--offsetX)) calc(var(--size) + var(--offsetY));
  background-size: calc(var(--size) * 2) calc(var(--size) * 2);
}
</style>
