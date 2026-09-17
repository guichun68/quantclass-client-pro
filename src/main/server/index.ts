/**
 * quantclass-client
 * Copyright (c) 2025 量化小讲堂
 *
 * Licensed under the Business Source License 1.1 (BUSL-1.1).
 * Additional Use Grant: None
 * Change Date: 2028-08-22 | Change License: GPL-3.0-or-later
 * See the LICENSE file and https://mariadb.com/bsl11/
 */

import { heartbeat } from "@/main/server/heartbeat.js"
import { DB } from "@/main/server/middleware/db.js"
import { platform } from "@electron-toolkit/utils"
import { Hono } from "hono"
import { logger as honoLogger } from "hono/logger"
import { prettyJSON } from "hono/pretty-json"
import { reportError } from "./controllers/error.js"
import { createNotification } from "./controllers/notify.js"
import {
	getAutoUpdateStatus,
	getAutoTradingStatus,
	getProductStatus,
	incrementalUpdate,
	setAutoTradingStatus,
	setAutoUpdateStatus,
} from "./controllers/product.js"
import { reportToast } from "./controllers/toast.js"
import { errorHandler } from "./middleware/error.js"
import type { Env } from "./types/index.js"

const server = new Hono<Env>()

// 全局中间件
server.use("*", honoLogger())
server.use("*", DB())
server.use("*", errorHandler())
server.use("*", prettyJSON())

// 基础路由
server.get("/", (c) => c.text("Hello World"))

// 错误上报路由
server.post("/error", reportError)

// 产品状态路由
server.get("/product-status", getProductStatus)
server.post("/product/incremental-update", incrementalUpdate)

// 订阅数据自动更新开关
server.get("/auto-update", getAutoUpdateStatus)
server.post("/auto-update", setAutoUpdateStatus)

// 自动实盘开关；开启时会同步确保订阅数据自动更新已开启
server.get("/auto-trading", getAutoTradingStatus)
server.post("/auto-trading", setAutoTradingStatus)

server.post("/toast", reportToast)

// 通知中心：内核（fuel/rocket/fusion）发起的统一通知入口
server.post("/notify", createNotification)

// 心跳路由只在 Windows 下注册
if (platform.isWindows) {
	server.get("/heartbeat", heartbeat)
}

export default server
