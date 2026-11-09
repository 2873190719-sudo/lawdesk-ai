#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
echo "LawDesk AI - 律师个人智能业务管理工作台"
echo "浏览器打开： http://127.0.0.1:8765"
echo "默认账号：admin  默认密码：lawdesk"
echo "数据保存在 data/ 目录，页面刷新后依然保留。"
exec python3 server.py
