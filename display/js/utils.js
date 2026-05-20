import { CONFIG } from './config.js';

/**
 * 格式化日期对象为 YYYY-MM-DD
 * @param {Date} date 
 * @returns {string}
 */
export function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 获取星期几的中文名称
 * @param {Date} date 
 * @returns {string}
 */
export function getWeekdayChinese(date) {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return weekdays[date.getDay()];
}

/**
 * 获取最近 N 天的日期列表 (从新到旧)
 * @param {Date} baseDate 基准日期
 * @param {number} count 数量
 * @returns {Array<{value: string, display: string, isToday: boolean}>}
 */
export function getRecentDates(baseDate, count = CONFIG.daysCount) {
  const dates = [];
  const todayStr = formatDate(new Date());
  
  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() - i);
    
    const valueStr = formatDate(d);
    const isToday = valueStr === todayStr;
    const isBase = valueStr === formatDate(baseDate);
    
    // 组装人性化显示，例如 "05-20 (周三)"
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    let display = `${mm}-${dd} ${getWeekdayChinese(d)}`;
    
    if (isToday) {
      display += ' (今天)';
    }
    
    dates.push({
      value: valueStr,
      display,
      isToday,
      isBase
    });
  }
  return dates;
}

/**
 * 获取最近 N 个 ISO 周列表 (从新到旧)
 * @param {Date} baseDate 基准日期
 * @param {number} count 数量
 * @returns {Array<{value: string, display: string, isToday: boolean, isBase: boolean}>}
 */
export function getRecentWeeks(baseDate, count = CONFIG.weeksCount) {
  const weeks = [];
  const currentWeekKey = formatIsoWeekKey(getIsoWeekStart(new Date()));
  const baseWeekStart = getIsoWeekStart(baseDate);

  for (let i = 0; i < count; i++) {
    const start = new Date(baseWeekStart);
    start.setUTCDate(baseWeekStart.getUTCDate() - i * 7);

    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);

    const valueStr = formatIsoWeekKey(start);
    weeks.push({
      value: valueStr,
      display: `${valueStr} (${formatMonthDay(start)}~${formatMonthDay(end)})`,
      isToday: valueStr === currentWeekKey,
      isBase: i === 0
    });
  }

  return weeks;
}

/**
 * 根据报告类型获取侧边栏列表项
 * @param {string} type 'daily' | 'weekly'
 * @returns {Array<{value: string, display: string, isToday: boolean, isBase: boolean}>}
 */
export function getRecentReportPeriods(type) {
  if (type === 'weekly') {
    return getRecentWeeks(CONFIG.baseDate);
  }
  return getRecentDates(CONFIG.baseDate);
}

/**
 * 获取报告的相对路径
 * @param {string} type 'daily' | 'weekly'
 * @param {string} date 'YYYY-MM-DD'
 * @returns {string}
 */
export function getReportUrl(type, date) {
  const reportType = CONFIG.reportTypes[type];
  if (!reportType) return '';
  if (type === 'weekly') {
    return `output/weekly/${date}/${reportType.fileName}`;
  }
  return `output/${date}/${reportType.fileName}`;
}

function getIsoWeekStart(date) {
  const start = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - weekday + 1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function formatIsoWeekKey(weekStart) {
  const thursday = new Date(weekStart);
  thursday.setUTCDate(weekStart.getUTCDate() + 3);
  const weekYear = thursday.getUTCFullYear();

  const weekOneAnchor = new Date(Date.UTC(weekYear, 0, 4));
  const weekOneWeekday = weekOneAnchor.getUTCDay() || 7;
  const weekOneStart = new Date(weekOneAnchor);
  weekOneStart.setUTCDate(weekOneAnchor.getUTCDate() - weekOneWeekday + 1);
  weekOneStart.setUTCHours(0, 0, 0, 0);

  const weekNumber = Math.floor((weekStart.getTime() - weekOneStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${weekYear}-W${String(weekNumber).padStart(2, '0')}`;
}

function formatMonthDay(date) {
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

/**
 * 检测远程文件是否存在 (HEAD 请求)
 * @param {string} url 
 * @returns {Promise<boolean>}
 */
export async function checkFileExists(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    // 如果返回 200，说明文件存在
    return response.ok;
  } catch (error) {
    console.warn(`检测文件是否存在失败: ${url}`, error);
    return false;
  }
}
