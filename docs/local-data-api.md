# 本地订阅数据 API

客户端在配置数据目录后启动本地 HTTP 服务，优先监听 `8787`；若端口已被占用，实际端口保存在本地设置的 `server_port` 中。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/product-status` | 获取当前订阅数据的本地状态。 |
| `POST` | `/product/incremental-update` | 触发订阅数据增量更新。空请求体更新全部订阅；`{"product":"产品名"}` 更新指定订阅，`name` 可作为兼容字段。 |
| `GET` | `/auto-update` | 获取订阅数据自动更新开关。 |
| `POST` | `/auto-update` | 设置自动更新开关，请求体为 `{"enabled":true}` 或 `{"enabled":false}`；`isOn` 可作为兼容字段。 |
| `GET` | `/auto-trading` | 获取自动实盘开关。 |
| `POST` | `/auto-trading` | 设置自动实盘开关，请求体为 `{"enabled":true}` 或 `{"enabled":false}`；开启时会同步开启订阅数据自动更新。 |

所有接口均返回 JSON，成功响应包含 `code: 200`。增量更新时 Fuel 内核忙碌返回 HTTP `409`；指定了未订阅产品返回 HTTP `404`；参数不合法返回 HTTP `400`。

```powershell
# 全部订阅数据增量更新
Invoke-RestMethod -Method Post http://127.0.0.1:8787/product/incremental-update

# 单个订阅数据增量更新
Invoke-RestMethod -Method Post http://127.0.0.1:8787/product/incremental-update `
  -ContentType application/json -Body '{"product":"stock_1h"}'

# 开启自动更新并查看状态
Invoke-RestMethod -Method Post http://127.0.0.1:8787/auto-update `
  -ContentType application/json -Body '{"enabled":true}'
Invoke-RestMethod http://127.0.0.1:8787/auto-update

# 启动自动实盘（同时启动订阅数据自动更新）
Invoke-RestMethod -Method Post http://127.0.0.1:8787/auto-trading `
  -ContentType application/json -Body '{"enabled":true}'
```
