import { CONFIG } from '../config.js';

export class TabComponent {
  /**
   * @param {string} containerId 挂载容器的 ID
   * @param {function} onChange 切换类型时的回调函数 (type) => void
   */
  constructor(containerId, onChange) {
    this.container = document.getElementById(containerId);
    this.onChange = onChange;
    this.currentType = CONFIG.defaultType;
    this.render();
  }

  /**
   * 设置当前选中的报告类型并重新渲染
   * @param {string} type 
   */
  setType(type) {
    if (this.currentType !== type) {
      this.currentType = type;
      this.render();
      this.onChange(type);
    }
  }

  /**
   * 渲染 Tab
   */
  render() {
    if (!this.container) return;

    this.container.innerHTML = '';
    
    // 创建一个包含所有 tab 的 wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'tab-wrapper';

    Object.values(CONFIG.reportTypes).forEach(type => {
      const button = document.createElement('button');
      button.className = `tab-btn ${this.currentType === type.id ? 'active' : ''}`;
      button.dataset.type = type.id;
      
      // 内部图标与文字
      const icon = type.id === 'daily' 
        ? `<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`
        : `<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20M4 19.5V3.5A2.5 2.5 0 0 1 6.5 1H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5z"/></svg>`;

      button.innerHTML = `${icon}<span>${type.label}</span>`;
      
      button.addEventListener('click', () => {
        this.setType(type.id);
      });

      wrapper.appendChild(button);
    });

    this.container.appendChild(wrapper);
  }
}
