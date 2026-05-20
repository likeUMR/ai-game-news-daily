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
    this.initSidebar();

    // 1. 初始化 Viewer 展示区
    this.viewer = new ViewerComponent('viewer-container');

    // 2. 初始化 DateList 日期选择区
    this.dateList = new DateListComponent('date-container', (dateStr) => {
      this.currentDate = dateStr;
      
      // 如果当前没有 type（例如此前点击了流程图），切回默认 type
      if (!this.currentType) {
        this.currentType = CONFIG.defaultType;
        this.tab.setType(CONFIG.defaultType);
      }
      
      // 移除流程图的高亮
      const flowchartBtn = document.getElementById('flowchart-btn');
      if (flowchartBtn) {
        flowchartBtn.classList.remove('active');
      }

      this.updateReport();
    });
    
    // 默认日期为日期列表中的第一个（最新的一天）
    this.currentDate = this.dateList.selectedDate;

    // 3. 初始化 Tab 类别选择区
    this.tab = new TabComponent('tab-container', (type) => {
      this.currentType = type;
      this.dateList.setType(type); // 日期组件切换类型，检查可用性
      
      // 同步更新 currentDate
      this.currentDate = this.dateList.selectedDate;

      // 移除流程图的高亮
      const flowchartBtn = document.getElementById('flowchart-btn');
      if (flowchartBtn) {
        flowchartBtn.classList.remove('active');
      }

      this.updateReport();
    });

    // 4. 初始化项目流程图按钮事件
    this.initFlowchart();

    // 5. 初次加载报告
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

  initFlowchart() {
    const flowchartBtn = document.getElementById('flowchart-btn');
    if (!flowchartBtn) return;

    flowchartBtn.addEventListener('click', (e) => {
      e.preventDefault();

      // 1. 设置自身高亮
      flowchartBtn.classList.add('active');

      // 2. 取消 Tab 和 DateList 的高亮及选中值
      this.tab.deselect();
      this.dateList.deselect();

      this.currentType = null;
      this.currentDate = null;

      // 3. 让 Viewer 载入流程图
      this.viewer.loadUrl(flowchartBtn.dataset.url || 'project-flow.html');
    });
  }

  initSidebar() {
    const sidebar = document.getElementById('app-sidebar');
    const toggle = document.getElementById('sidebar-toggle');

    if (!sidebar || !toggle) return;

    toggle.addEventListener('click', () => {
      const isCollapsed = sidebar.classList.toggle('is-collapsed');
      sidebar.classList.toggle('is-open', !isCollapsed);
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      toggle.setAttribute('aria-label', isCollapsed ? '展开侧边栏' : '收起侧边栏');
    });
  }
}

// 当 DOM 加载完成后运行应用
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
