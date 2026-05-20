import { getRecentDates, getReportUrl, checkFileExists } from '../utils.js';
import { CONFIG } from '../config.js';

export class DateListComponent {
  /**
   * @param {string} containerId 挂载容器的 ID
   * @param {function} onChange 切换日期时的回调函数 (dateStr) => void
   */
  constructor(containerId, onChange) {
    this.container = document.getElementById(containerId);
    this.onChange = onChange;
    this.dates = getRecentDates(CONFIG.baseDate);
    this.selectedDate = this.dates[0].value; // 默认选中最新的一天
    this.currentType = CONFIG.defaultType;
    this.fileExistenceMap = {}; // 缓存检测过的文件状态： { "daily_2026-05-20": true }

    this.render();
    this.checkAllFiles(); // 异步检测可用性
  }

  /**
   * 更新报告类型并重新渲染（可能需要重新检测文件，因为日报和周报的文件不同）
   * @param {string} type 
   */
  setType(type) {
    if (this.currentType !== type) {
      this.currentType = type;
      this.render();
      this.checkAllFiles();
    }
  }

  /**
   * 设置选中的日期
   * @param {string} dateStr 
   */
  setDate(dateStr) {
    if (this.selectedDate !== dateStr) {
      this.selectedDate = dateStr;
      this.render();
      this.onChange(dateStr);
    }
  }

  /**
   * 异步检测最近 7 天所有文件的存在性，检测完毕后动态更新 UI
   */
  async checkAllFiles() {
    const type = this.currentType;
    const promises = this.dates.map(async (item) => {
      const cacheKey = `${type}_${item.value}`;
      
      // 如果已经检测并缓存，就不再重复检测
      if (this.fileExistenceMap[cacheKey] !== undefined) {
        return;
      }

      const url = getReportUrl(type, item.value);
      const exists = await checkFileExists(url);
      this.fileExistenceMap[cacheKey] = exists;
      
      // 单个文件检测完后，如果当前类型没变，就局部更新这个日期的按钮状态
      if (this.currentType === type) {
        const btn = this.container?.querySelector(`[data-date="${item.value}"]`);
        if (btn) {
          if (exists) {
            btn.classList.add('has-report');
          } else {
            btn.classList.add('no-report');
          }
        }
      }
    });

    await Promise.all(promises);
  }

  /**
   * 渲染日期选择器
   */
  render() {
    if (!this.container) return;

    this.container.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'date-list-title';
    label.innerText = '选择报告日期:';
    this.container.appendChild(label);

    const listWrapper = document.createElement('div');
    listWrapper.className = 'date-buttons-container';

    this.dates.forEach(item => {
      const button = document.createElement('button');
      button.className = `date-btn ${this.selectedDate === item.value ? 'active' : ''}`;
      button.dataset.date = item.value;
      
      // 应用缓存的文件存在状态
      const cacheKey = `${this.currentType}_${item.value}`;
      if (this.fileExistenceMap[cacheKey] !== undefined) {
        if (this.fileExistenceMap[cacheKey]) {
          button.classList.add('has-report');
        } else {
          button.classList.add('no-report');
        }
      }

      button.innerHTML = `
        <span class="date-display-text">${item.display}</span>
        <span class="status-indicator"></span>
      `;

      button.addEventListener('click', () => {
        this.setDate(item.value);
      });

      listWrapper.appendChild(button);
    });

    this.container.appendChild(listWrapper);
  }
}
