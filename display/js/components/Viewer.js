import { getReportUrl, checkFileExists } from '../utils.js';

export class ViewerComponent {
  /**
   * @param {string} containerId 挂载容器的 ID
   */
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentUrl = '';
    this.render();
  }

  /**
   * 加载指定类型和日期的报告
   * @param {string} type 'daily' | 'weekly'
   * @param {string} date 'YYYY-MM-DD'
   */
  async loadReport(type, date) {
    const loader = this.container.querySelector('.viewer-loader');
    const iframe = this.container.querySelector('.viewer-iframe');
    const emptyState = this.container.querySelector('.viewer-empty');
    
    // 显示 Loading，隐藏 iframe 和空状态
    loader.classList.add('visible');
    iframe.classList.remove('visible');
    emptyState.classList.remove('visible');
    
    const url = getReportUrl(type, date);
    this.currentUrl = url;

    // 检查文件是否存在
    const exists = await checkFileExists(url);
    
    // 如果在异步检测期间，用户已经切换到了其他报告，我们就放弃本次加载
    if (this.currentUrl !== url) return;

    if (exists) {
      // 文件存在，加载到 iframe 中
      iframe.src = url;
    } else {
      // 文件不存在，显示空状态
      loader.classList.remove('visible');
      emptyState.classList.add('visible');
      
      const typeLabel = type === 'daily' ? '每日日报 (WeChat)' : '每周精选 (Weekly)';
      emptyState.innerHTML = `
        <div class="empty-icon-wrapper">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            <path d="M12 11v6M9 14h6"/>
          </svg>
        </div>
        <p class="empty-title">暂无相关报告</p>
        <p class="empty-desc">在 <strong>${date}</strong> 这一天，系统尚未生成 <strong>${typeLabel}</strong>。</p>
        <p class="empty-tip">提示：请在下方日期中选择带有绿色指示灯的日期，或运行 pipeline 生成该日期报告。</p>
      `;
    }
  }

  /**
   * 渲染 Viewer 基础骨架
   */
  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="viewer-card">
        <!-- 头部工具栏 -->
        <div class="viewer-header">
          <div class="viewer-dot-group">
            <span class="viewer-dot red"></span>
            <span class="viewer-dot yellow"></span>
            <span class="viewer-dot green"></span>
          </div>
          <div class="viewer-title-address">Report Viewer</div>
          <button class="viewer-refresh-btn" title="在新窗口打开" id="open-new-window-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
            </svg>
          </button>
        </div>

        <!-- 内容区域 -->
        <div class="viewer-body">
          <!-- Loader -->
          <div class="viewer-loader visible">
            <div class="loader-spinner"></div>
            <p class="loader-text">正在为您加载并渲染报告，请稍候...</p>
          </div>

          <!-- Empty State -->
          <div class="viewer-empty"></div>

          <!-- Iframe -->
          <iframe class="viewer-iframe" frameborder="0"></iframe>
        </div>
      </div>
    `;

    // 绑定 Iframe 加载完成事件
    const iframe = this.container.querySelector('.viewer-iframe');
    const loader = this.container.querySelector('.viewer-loader');
    
    iframe.addEventListener('load', () => {
      // 检查当前 URL 确保没有被覆盖
      if (iframe.src && iframe.src.includes(this.currentUrl)) {
        loader.classList.remove('visible');
        iframe.classList.add('visible');
      }
    });

    // 绑定“在新窗口打开”按钮
    const openBtn = this.container.querySelector('#open-new-window-btn');
    openBtn.addEventListener('click', () => {
      if (this.currentUrl) {
        window.open(this.currentUrl, '_blank');
      }
    });
  }
}
