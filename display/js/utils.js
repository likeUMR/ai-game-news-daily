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
 * 获取报告的相对路径
 * @param {string} type 'daily' | 'weekly'
 * @param {string} date 'YYYY-MM-DD'
 * @returns {string}
 */
export function getReportUrl(type, date) {
  const reportType = CONFIG.reportTypes[type];
  if (!reportType) return '';
  return `output/${date}/${reportType.fileName}`;
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
