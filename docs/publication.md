# 日报发布与补发

Linux 定时任务继续使用 `scripts/cron-daily.sh` 和 `scripts/cron-weekly.sh`。更新运行目录的代码后，执行 `npm ci` 和 `npm run test:llm` 验证该主机上配置的中转服务。

Windows 工作站的“AI 游戏新闻补发”任务于北京时间每天 09:35 核对当天线上日报，周日同时核对周报。电脑离线错过时间时，任务会在下次可用时核对当日版本。已有含来源的正文时立即结束；缺报或空报时用本机环境采集、生成并补发。生成完成后再次读取远端内容并校验文件版本，保护其他发布任务已经写入的正文。

运行 `node scripts/publish-if-missing.mjs` 可以手动核对当天发布。Windows 任务使用当前用户的 GitHub SSH 凭据，只提交对应报告的 HTML。任务日志与发布缓存保存在本项目的 `logs` 目录。
