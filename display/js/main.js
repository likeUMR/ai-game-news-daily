import { TabComponent } from './components/Tab.js';
import { DateListComponent } from './components/DateList.js';
import { ViewerComponent } from './components/Viewer.js';
import { CONFIG } from './config.js';

class App {
  constructor() {
    this.currentType = CONFIG.defaultType;
    this.currentDate = null;
    
    this.init();
  }

  init() {
    // 1. 初始化 Viewer 展示区
    this.viewer = new ViewerComponent('viewer-container');

    // 2. 初始化 DateList 日期选择区
    this.dateList = new DateListComponent('date-container', (dateStr) => {
      this.currentDate = dateStr;
      this.updateReport();
    });
    
    // 默认日期为日期列表中的第一个（最新的一天）
    this.currentDate = this.dateList.selectedDate;

    // 3. 初始化 Tab 类别选择区
    this.tab = new TabComponent('tab-container', (type) => {
      this.currentType = type;
      this.dateList.setType(type); // 日期组件切换类型，检查可用性
      this.updateReport();
    });

    // 4. 初次加载报告
    this.updateReport();
  }

  /**
   * 触发报告更新加载
   */
  updateReport() {
    if (this.currentType && this.currentDate) {
      this.viewer.loadReport(this.currentType, this.currentDate);
    }
  }
}

// 当 DOM 加载完成后运行应用
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
