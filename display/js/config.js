/**
 * 智游镜展示页全局配置
 */

// 默认基准日期为 2026-05-20 (由于本系统是在 2026-05-20 运行并有数据的，以此为基准最安全)
// 如果当前系统时间晚于 2026-05-20，我们可以自动使用当前日期
const getBaseDate = () => {
  const today = new Date();
  const targetDate = new Date('2026-05-20');
  
  // 如果系统时间小于 2026-05-20 (比如测试环境)，或者大于它，我们都进行智能处理
  // 这里返回一个 YYYY-MM-DD 的 Date 对象
  return today > targetDate ? today : targetDate;
};

export const CONFIG = {
  // 基础日期
  baseDate: getBaseDate(),
  
  // 显示最近多少天
  daysCount: 7,

  // 每周精选显示最近多少周
  weeksCount: 4,
  
  // 报告类型定义
  reportTypes: {
    daily: {
      id: 'daily',
      label: '每日日报 (WeChat)',
      fileName: 'wechat.html',
    },
    weekly: {
      id: 'weekly',
      label: '每周精选 (Weekly)',
      fileName: 'weekly.html',
    }
  },
  
  // 默认选中的类型
  defaultType: 'daily',
};
